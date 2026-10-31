import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp"
import { connections, db, type Connection, type McpServer } from "@crew/db"
import { decrypt, decryptJson, encrypt, encryptJson, randomToken, serverUrl } from "@crew/shared/node"
import { and, eq } from "drizzle-orm"

export const OAUTH_CALLBACK_PATH = "/oauth/mcp/callback"
export const oauthRedirectUrl = () => `${serverUrl()}${OAUTH_CALLBACK_PATH}`

// A pre-registered OAuth app from env: <PREFIX>_CLIENT_ID and <PREFIX>_CLIENT_SECRET
export function staticClient(server: Pick<McpServer, "staticClientEnv">) {
  const prefix = server.staticClientEnv
  const clientId = prefix ? process.env[`${prefix}_CLIENT_ID`] : undefined
  if (!prefix || !clientId) return undefined
  return { clientId, clientSecret: process.env[`${prefix}_CLIENT_SECRET`] }
}

type Patch = Partial<typeof connections.$inferInsert>

// OAuthClientProvider backed by one connections row. Secrets are encrypted at
// rest; the in-memory row is kept in sync so one auth() call sees its own writes.
export class ConnectionOAuthProvider implements OAuthClientProvider {
  // Set by redirectToAuthorization; the caller sends the person there
  authorizationUrl?: URL

  constructor(
    private conn: Connection,
    private server: McpServer,
    // Static authorization server for pre-registered clients (catalog)
    private staticAuthServer?: OAuthAuthorizationServerInformation,
  ) {}

  private async patch(values: Patch) {
    Object.assign(this.conn, values)
    await db.update(connections).set(values).where(eq(connections.id, this.conn.id))
  }

  get redirectUrl() {
    return oauthRedirectUrl()
  }

  get clientMetadata(): OAuthClientMetadata {
    const confidential = !!staticClient(this.server)?.clientSecret
    return {
      client_name: "Crew",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: confidential ? "client_secret_post" : "none",
      ...(this.server.scopes ? { scope: this.server.scopes } : {}),
    }
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const fixed = staticClient(this.server)
    if (fixed) {
      return {
        client_id: fixed.clientId,
        ...(fixed.clientSecret ? { client_secret: fixed.clientSecret } : {}),
        ...(this.staticAuthServer?.issuer ? { issuer: this.staticAuthServer.issuer } : {}),
      }
    }
    return decryptJson<OAuthClientInformation>(this.conn.clientInfo)
  }

  isClientInformationDynamicallyRegistered() {
    return !staticClient(this.server)
  }

  async saveClientInformation(info: OAuthClientInformation) {
    await this.patch({ clientInfo: encryptJson(info) })
  }

  async tokens() {
    return decryptJson<OAuthTokens>(this.conn.tokens)
  }

  async saveTokens(tokens: OAuthTokens) {
    // Some servers (Google among them) omit the refresh token on refresh
    const prev = await this.tokens()
    const merged = { ...tokens, refresh_token: tokens.refresh_token ?? prev?.refresh_token }
    await this.patch({ tokens: encryptJson(merged), status: "active", error: null })
  }

  async redirectToAuthorization(url: URL) {
    for (const [k, v] of Object.entries(this.server.authParams ?? {})) url.searchParams.set(k, v)
    this.authorizationUrl = url
  }

  async saveCodeVerifier(verifier: string) {
    await this.patch({ codeVerifier: encrypt(verifier) })
  }

  async codeVerifier() {
    if (!this.conn.codeVerifier) throw new Error("No sign-in in progress for this connection")
    return decrypt(this.conn.codeVerifier)
  }

  state() {
    return randomToken(24)
  }

  async saveState(state: string) {
    await this.patch({ state })
  }

  storedState() {
    return this.conn.state ?? undefined
  }

  authorizationServerInformation() {
    return this.staticAuthServer ?? this.conn.authServer ?? undefined
  }

  async saveAuthorizationServerInformation(info: OAuthAuthorizationServerInformation) {
    await this.patch({ authServer: info })
  }

  // Compare-and-delete so a concurrent refresh's new tokens survive
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier", context?: { tokens: OAuthTokens }) {
    if (scope === "verifier") return this.patch({ codeVerifier: null })
    if (scope === "client") return this.patch({ clientInfo: null })
    if (scope === "tokens" && context?.tokens) {
      const current = await this.freshTokens()
      if (current?.access_token !== context.tokens.access_token) return
    }
    const values: Patch =
      scope === "all" ? { tokens: null, clientInfo: null, codeVerifier: null, status: "error" } : { tokens: null }
    const where = scope === "tokens" && this.conn.tokens
      ? and(eq(connections.id, this.conn.id), eq(connections.tokens, this.conn.tokens))
      : eq(connections.id, this.conn.id)
    Object.assign(this.conn, values)
    await db.update(connections).set(values).where(where)
  }

  private async freshTokens() {
    const [row] = await db.select({ tokens: connections.tokens }).from(connections).where(eq(connections.id, this.conn.id))
    if (row) this.conn.tokens = row.tokens
    return decryptJson<OAuthTokens>(row?.tokens)
  }
}
