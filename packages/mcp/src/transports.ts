import type { MCPClientConfig } from "@ai-sdk/mcp"
import { getWorkstation } from "@crew/computer"
import { connections, db, type Connection, type McpServer } from "@crew/db"
import { PORTS } from "@crew/shared"
import { decrypt, decryptJson, serverUrl, signToken } from "@crew/shared/node"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { and, eq, isNotNull } from "drizzle-orm"

import { catalogBySlug } from "./catalog"
import { ConnectionOAuthProvider } from "./oauth-provider"
import { assertPublicUrl } from "./url-guard"

export type TransportContext = { userId: string; connection: Connection; server: McpServer }
export type TransportSpec = MCPClientConfig["transport"]

// One way of reaching an MCP server. The loader picks the first that matches,
// so a new kind of server is one more entry here and nothing else changes.
export interface ConnectorTransport {
  name: string
  matches(server: McpServer): boolean
  open(ctx: TransportContext): Promise<TransportSpec>
}

// Short-lived bearer for our own /mcp/<slug> and device relay endpoints
export const internalMcpToken = (connectionId: string, ttlSec = 15 * 60) => signToken({ cid: connectionId }, ttlSec)

const remoteHttp: ConnectorTransport = {
  name: "remote-http",
  matches: (s) => s.transport === "http" && s.authMode !== "first_party",
  async open({ connection, server }) {
    if (!server.url) throw new Error(`${server.name} has no URL`)
    if (server.isCustom) await assertPublicUrl(server.url)
    if (server.authMode === "oauth") {
      const authProvider = new ConnectionOAuthProvider(connection, server, catalogBySlug(server.slug)?.authorizationServer)
      return { type: "http", url: server.url, authProvider }
    }
    const headers: Record<string, string> = {}
    if (connection.tokens) headers.authorization = `Bearer ${decrypt(connection.tokens)}`
    return { type: "http", url: server.url, headers }
  },
}

const firstPartyHttp: ConnectorTransport = {
  name: "first-party",
  matches: (s) => s.authMode === "first_party",
  async open({ connection, server }) {
    return {
      type: "http",
      url: `${serverUrl()}/mcp/${server.slug}`,
      headers: { authorization: `Bearer ${internalMcpToken(connection.id)}` },
    }
  },
}

// Next free bridge port on the person's computer (7100+i)
async function bridgePort(connection: Connection) {
  if (connection.bridgePort) return connection.bridgePort
  const rows = await db
    .select({ port: connections.bridgePort })
    .from(connections)
    .where(and(eq(connections.userId, connection.userId), isNotNull(connections.bridgePort)))
  const used = new Set(rows.map((r) => r.port))
  let i = 0
  while (used.has(PORTS.bridge(i))) i++
  const port = PORTS.bridge(i)
  await db.update(connections).set({ bridgePort: port }).where(eq(connections.id, connection.id))
  connection.bridgePort = port
  return port
}

// A local-command server run on the cloud computer under supervisord and
// exposed over streamable HTTP by supergateway
const cloudStdio: ConnectorTransport = {
  name: "cloud-stdio",
  matches: (s) => s.transport === "stdio" && s.runOn !== "device",
  async open({ userId, connection, server }) {
    if (!server.command) throw new Error(`${server.name} has no command`)
    const ws = await getWorkstation(userId)
    const port = await bridgePort(connection)
    const { path } = await ws.ensureBridge({
      id: connection.id,
      port,
      command: server.command,
      args: server.args ?? [],
      env: decryptJson<Record<string, string>>(connection.env) ?? {},
    })
    const ep = await ws.computer.portEndpoint(port)
    return { type: "http", url: `${ep.url}${path}`, headers: ep.headers }
  },
}

// A local-command server on the person's Mac, tunnelled through the device
// relay: JSON-RPC frames over a WebSocket to the server, then to the app
const deviceStdio: ConnectorTransport = {
  name: "device-stdio",
  matches: (s) => s.transport === "stdio" && s.runOn === "device",
  async open({ connection, server }) {
    if (!server.deviceId) throw new Error(`${server.name} isn't linked to a computer`)
    const url = new URL(`${serverUrl().replace(/^http/, "ws")}/internal/devices/${server.deviceId}/mcp`)
    url.searchParams.set("token", internalMcpToken(connection.id))
    return new WebSocketClientTransport(url)
  },
}

export const TRANSPORTS: ConnectorTransport[] = [firstPartyHttp, remoteHttp, cloudStdio, deviceStdio]

export function openTransport(ctx: TransportContext) {
  const t = TRANSPORTS.find((x) => x.matches(ctx.server))
  if (!t) throw new Error(`No way to reach ${ctx.server.name}`)
  return t.open(ctx)
}
