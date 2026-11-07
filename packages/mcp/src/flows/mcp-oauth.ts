import { auth } from "@ai-sdk/mcp"

import { catalogBySlug } from "../catalog"
import { ConnectionOAuthProvider } from "../oauth-provider"
import { assertPublicUrl } from "../url-guard"
import type { ConnectFlow, FlowContext } from "./types"

function provider({ connection, server }: FlowContext) {
  return new ConnectionOAuthProvider(connection, server, catalogBySlug(server.slug)?.authorizationServer)
}

async function serverUrl(ctx: FlowContext) {
  if (!ctx.server.url) throw new Error(`${ctx.server.name} has no URL`)
  if (ctx.server.isCustom) await assertPublicUrl(ctx.server.url)
  return ctx.server.url
}

// Spec-compliant MCP OAuth: discovery, dynamic registration (or a
// pre-registered app), PKCE and refresh, all handled by @ai-sdk/mcp
export const mcpOAuthFlow: ConnectFlow = {
  async start(ctx) {
    const p = provider(ctx)
    const result = await auth(p, { serverUrl: await serverUrl(ctx), scope: ctx.server.scopes ?? undefined })
    if (result === "AUTHORIZED") return { connected: true }
    if (!p.authorizationUrl) throw new Error("The server did not return a sign-in page")
    return { authorizeUrl: p.authorizationUrl.toString() }
  },

  async finish(ctx, { code, state, iss }) {
    const result = await auth(provider(ctx), {
      serverUrl: await serverUrl(ctx),
      authorizationCode: code,
      callbackState: state,
      callbackIssuer: iss,
    })
    if (result !== "AUTHORIZED") throw new Error("Sign-in did not complete")
    return {}
  },
}
