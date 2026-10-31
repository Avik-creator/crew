import { createMCPClient } from "@ai-sdk/mcp"
import { getWorkstation } from "@crew/computer"
import { connections, db, mcpServers, type CachedTool, type Connection, type McpServer } from "@crew/db"
import { encrypt, encryptJson } from "@crew/shared/node"
import { and, eq } from "drizzle-orm"

import { CATALOG } from "./catalog"
import { flowFor, type CallbackParams } from "./flows"
import { openTransport } from "./transports"

// Mirrors the built-in catalog into mcp_servers (templates stay in code)
export async function seedCatalog() {
  for (const c of CATALOG.filter((x) => !x.template)) {
    const values = {
      name: c.name,
      description: c.description,
      icon: c.icon,
      transport: c.transport,
      url: c.url ?? null,
      command: c.command ?? null,
      args: c.args ?? null,
      envKeys: c.envKeys ?? null,
      runOn: c.runOn ?? null,
      authMode: c.authMode,
      staticClientEnv: c.staticClientEnv ?? null,
      scopes: c.scopes ?? null,
      authParams: c.authParams ?? null,
      hardApprovalTools: c.hardApprovalTools ?? null,
      defaultAskTools: null,
    }
    await db
      .insert(mcpServers)
      .values({ slug: c.slug, ...values })
      .onConflictDoUpdate({ target: mcpServers.slug, set: values })
  }
}

async function load(userId: string, serverId: string) {
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId))
  if (!server) throw new Error("Connector not found")
  if (server.isCustom && server.addedByUserId !== userId) throw new Error("Connector not found")
  const [connection] = await db
    .insert(connections)
    .values({ userId, serverId })
    .onConflictDoUpdate({ target: [connections.userId, connections.serverId], set: { updatedAt: new Date() } })
    .returning()
  return { server, connection: connection! }
}

// Begins connecting: either a sign-in URL to open, or done right away
export async function startConnect(userId: string, serverId: string) {
  const ctx = await load(userId, serverId)
  const flow = flowFor(ctx.server)
  if (!flow) {
    await markActive(ctx.connection.id)
    return { connected: true as const }
  }
  const result = await flow.start(ctx)
  if ("connected" in result) await markActive(ctx.connection.id)
  return result
}

// The OAuth redirect lands here; the state identifies the connection
export async function finishConnect(params: CallbackParams & { error?: string }) {
  const [connection] = await db.select().from(connections).where(eq(connections.state, params.state))
  if (!connection) throw new Error("This sign-in link has expired. Start again from Connections.")
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, connection.serverId))
  if (!server) throw new Error("Connector not found")
  if (params.error) {
    await db.update(connections).set({ status: "error", error: params.error, state: null }).where(eq(connections.id, connection.id))
    throw new Error(`Sign-in was cancelled (${params.error})`)
  }
  const flow = flowFor(server)
  if (!flow) throw new Error(`${server.name} doesn't use sign-in`)
  const { accountLabel } = await flow.finish({ connection, server }, params)
  await db
    .update(connections)
    .set({ status: "active", error: null, state: null, ...(accountLabel ? { accountLabel } : {}) })
    .where(eq(connections.id, connection.id))
  void refreshTools(connection.id).catch(() => {})
  return { server, connection }
}

async function markActive(connectionId: string) {
  await db.update(connections).set({ status: "active", error: null }).where(eq(connections.id, connectionId))
  void refreshTools(connectionId).catch(() => {})
}

// For servers that take a pasted token or environment variables
export async function saveSecrets(
  userId: string,
  serverId: string,
  secrets: { token?: string; env?: Record<string, string> },
) {
  const { connection } = await load(userId, serverId)
  await db
    .update(connections)
    .set({
      ...(secrets.token ? { tokens: encrypt(secrets.token) } : {}),
      ...(secrets.env ? { env: encryptJson(secrets.env) } : {}),
      status: "active",
      error: null,
      toolsCache: null,
    })
    .where(eq(connections.id, connection.id))
  void refreshTools(connection.id).catch(() => {})
}

export async function disconnect(userId: string, serverId: string) {
  const [row] = await db
    .delete(connections)
    .where(and(eq(connections.userId, userId), eq(connections.serverId, serverId)))
    .returning()
  if (row?.bridgePort) {
    const ws = await getWorkstation(userId).catch(() => null)
    await ws?.removeBridge(row.id)
  }
}

export async function connectionWithServer(connectionId: string) {
  const [row] = await db
    .select({ connection: connections, server: mcpServers })
    .from(connections)
    .innerJoin(mcpServers, eq(mcpServers.id, connections.serverId))
    .where(eq(connections.id, connectionId))
  return row
}

// Lists tools once and caches the definitions so turns skip tools/list
export async function refreshTools(connectionId: string) {
  const row = await connectionWithServer(connectionId)
  if (!row) return []
  const tools = await listTools(row.connection, row.server)
  await db
    .update(connections)
    .set({ toolsCache: tools, toolsCachedAt: new Date(), status: "active", error: null })
    .where(eq(connections.id, connectionId))
  return tools
}

async function listTools(connection: Connection, server: McpServer): Promise<CachedTool[]> {
  const client = await createMCPClient({
    transport: await openTransport({ userId: connection.userId, connection, server }),
    clientName: "crew",
  })
  try {
    const out: CachedTool[] = []
    let cursor: string | undefined
    do {
      const page = await client.listTools(cursor ? { params: { cursor } } : undefined)
      out.push(...(page.tools as CachedTool[]))
      cursor = page.nextCursor
    } while (cursor)
    return out
  } finally {
    await client.close().catch(() => {})
  }
}
