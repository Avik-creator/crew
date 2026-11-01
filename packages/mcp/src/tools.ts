import { createMCPClient, type ListToolsResult, type MCPClient } from "@ai-sdk/mcp"
import { connections, db, mcpServers, toolPrefs, type Connection, type McpServer } from "@crew/db"
import { MCP_TOOL_SEPARATOR } from "@crew/shared"
import type { Tool, ToolApprovalStatus } from "ai"
import { and, eq } from "drizzle-orm"

import { refreshTools } from "./connections"
import { decide, DEFAULT_RULES, type ApprovalRule, type ToolDecision } from "./policy"
import { openTransport } from "./transports"

export type ConnectorToolInfo = {
  serverId: string
  serverName: string
  serverSlug: string
  icon: string
  toolName: string
  title: string
  decision: ToolDecision
}

export type ConnectorToolset = {
  tools: Record<string, Tool>
  // Per-tool approval for streamText's toolApproval
  approval: Record<string, ToolApprovalStatus>
  info: Record<string, ConnectorToolInfo>
  // Server-provided usage notes for the system prompt
  instructions: string[]
  // Connectors that couldn't be reached this turn
  unavailable: { name: string; reason: string }[]
  close(): Promise<void>
}

// Provider tool names: [a-zA-Z0-9_-]{1,64}
export const toolKey = (slug: string, name: string) =>
  `${slug}${MCP_TOOL_SEPARATOR}${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)

const toStatus = (d: ToolDecision): ToolApprovalStatus => (d === "auto" ? "not-applicable" : "user-approval")

function withTimeout<T>(p: Promise<T>, ms: number, label: string) {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} took too long to respond`)), ms)),
  ])
}

const isAuthError = (err: unknown) =>
  /unauthori[sz]ed|401|invalid_grant|invalid_token|not connected/i.test(err instanceof Error ? err.message : String(err))

// Every active connection on the account, as AI SDK tools with an approval
// decision per tool. A connection is for every bot. Failures are reported,
// never fatal to the turn.
export async function loadConnectorTools(opts: {
  userId: string
  botId: string
  background: boolean
  rules?: ApprovalRule[]
  timeoutMs?: number
}): Promise<ConnectorToolset> {
  const { userId, background, rules = DEFAULT_RULES, timeoutMs = 25_000 } = opts
  const rows = await db
    .select({ server: mcpServers, connection: connections })
    .from(connections)
    .innerJoin(mcpServers, eq(mcpServers.id, connections.serverId))
    .where(and(eq(connections.userId, userId), eq(connections.status, "active")))
  const prefs = await db.select().from(toolPrefs).where(eq(toolPrefs.userId, userId))
  const prefOf = (serverId: string, tool: string) =>
    prefs.find((p) => p.serverId === serverId && p.toolName === tool)?.mode

  const out: ConnectorToolset = {
    tools: {},
    approval: {},
    info: {},
    instructions: [],
    unavailable: [],
    close: async () => {},
  }
  const clients: MCPClient[] = []
  out.close = async () => {
    await Promise.allSettled(clients.map((c) => c.close()))
  }

  const open = async ({ server, connection }: { server: McpServer; connection: Connection }) => {
    const transport = await openTransport({ userId, connection, server })
    const client = await createMCPClient({ transport, clientName: "crew", onUncaughtError: () => {} })
    clients.push(client)
    const defs = connection.toolsCache?.length ? connection.toolsCache : await refreshTools(connection.id)
    const set = client.toolsFromDefinitions({ tools: defs } as ListToolsResult)
    for (const def of defs) {
      const tool = set[def.name]
      if (!tool) continue
      const decision = decide({ server, tool: def, pref: prefOf(server.id, def.name), background }, rules)
      if (decision === "hidden") continue
      const key = toolKey(server.slug, def.name)
      out.tools[key] = tool as Tool
      out.approval[key] = toStatus(decision)
      out.info[key] = {
        serverId: server.id,
        serverName: server.name,
        serverSlug: server.slug,
        icon: server.icon,
        toolName: def.name,
        title: def.title ?? def.annotations?.title?.toString() ?? def.name,
        decision,
      }
    }
    if (client.instructions) out.instructions.push(`${server.name}: ${client.instructions}`)
  }

  const results = await Promise.allSettled(rows.map((r) => withTimeout(open(r), timeoutMs, r.server.name)))
  await Promise.all(
    results.map(async (res, i) => {
      if (res.status === "fulfilled") return
      const { server, connection } = rows[i]!
      const message = res.reason instanceof Error ? res.reason.message : String(res.reason)
      const needsSignIn = isAuthError(res.reason)
      out.unavailable.push({ name: server.name, reason: needsSignIn ? "needs to be reconnected" : message })
      if (needsSignIn) {
        await db
          .update(connections)
          .set({ status: "error", error: "Sign-in expired. Reconnect to keep using it." })
          .where(eq(connections.id, connection.id))
      }
    }),
  )
  return out
}
