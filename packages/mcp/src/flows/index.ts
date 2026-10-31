import type { McpServer } from "@crew/db"

import { firstParty } from "../first-party"
import { mcpOAuthFlow } from "./mcp-oauth"
import type { ConnectFlow } from "./types"

export * from "./types"

export function flowFor(server: McpServer): ConnectFlow | undefined {
  if (server.authMode === "first_party") return firstParty(server.slug)?.flow
  if (server.authMode === "oauth") return mcpOAuthFlow
  return undefined
}
