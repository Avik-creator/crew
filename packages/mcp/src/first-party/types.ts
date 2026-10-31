import type { Connection, McpServer as ServerRow } from "@crew/db"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import type { ConnectFlow } from "../flows/types"

// A connector we host ourselves at /mcp/<slug>: our own OAuth with the
// provider, and an MCP server bound to one connection's credentials.
export interface FirstPartyConnector {
  slug: string
  flow: ConnectFlow
  createServer(connection: Connection, server: ServerRow): McpServer
}
