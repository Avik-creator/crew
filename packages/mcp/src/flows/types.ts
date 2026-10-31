import type { Connection, McpServer } from "@crew/db"

export type FlowContext = { connection: Connection; server: McpServer }

export type CallbackParams = { code: string; state: string; iss?: string }

// How a connector gets its credentials. Remote MCP servers use the MCP OAuth
// spec; first-party servers talk to their provider's OAuth directly.
export interface ConnectFlow {
  // A URL to send the person to, or connected when no sign-in is needed
  start(ctx: FlowContext): Promise<{ authorizeUrl: string } | { connected: true }>
  finish(ctx: FlowContext, params: CallbackParams): Promise<{ accountLabel?: string }>
}
