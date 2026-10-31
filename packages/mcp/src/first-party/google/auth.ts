import { connections, db, type Connection, type McpServer } from "@crew/db"
import { decrypt, decryptJson, encrypt, encryptJson, randomToken } from "@crew/shared/node"
import { eq } from "drizzle-orm"
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library"

import type { ConnectFlow } from "../../flows/types"
import { oauthRedirectUrl, staticClient } from "../../oauth-provider"

function client(server: McpServer) {
  const app = staticClient(server)
  if (!app?.clientSecret) {
    throw new Error("Google isn't set up yet: add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to the server env")
  }
  return new OAuth2Client({ clientId: app.clientId, clientSecret: app.clientSecret, redirectUri: oauthRedirectUrl() })
}

// Google's own OAuth via google-auth-library: PKCE, offline access for a
// refresh token, and the account email from the ID token
export const googleFlow: ConnectFlow = {
  async start({ connection, server }) {
    const oauth = client(server)
    const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync()
    const state = randomToken(24)
    await db
      .update(connections)
      .set({ state, codeVerifier: encrypt(codeVerifier) })
      .where(eq(connections.id, connection.id))
    const authorizeUrl = oauth.generateAuthUrl({
      scope: server.scopes?.split(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      ...server.authParams,
    })
    return { authorizeUrl }
  },

  async finish({ connection, server }, { code, state }) {
    if (!connection.state || connection.state !== state) throw new Error("Sign-in expired, please try again")
    if (!connection.codeVerifier) throw new Error("No sign-in in progress")
    const oauth = client(server)
    const { tokens } = await oauth.getToken({ code, codeVerifier: decrypt(connection.codeVerifier) })
    let accountLabel: string | undefined
    if (tokens.id_token) {
      const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: staticClient(server)?.clientId })
      accountLabel = ticket.getPayload()?.email
    }
    await db
      .update(connections)
      .set({
        tokens: encryptJson(tokens),
        scopes: tokens.scope ?? server.scopes,
        status: "active",
        error: null,
        codeVerifier: null,
        accountLabel,
      })
      .where(eq(connections.id, connection.id))
    return { accountLabel }
  },
}

// An authorized client for one connection; refreshed tokens are written back
export function googleAuth(connection: Connection, server: McpServer) {
  const oauth = client(server)
  const stored = decryptJson<Credentials>(connection.tokens)
  if (!stored?.refresh_token && !stored?.access_token) throw new Error("Google is not connected")
  oauth.setCredentials(stored)
  oauth.on("tokens", (fresh) => {
    const merged = { ...stored, ...fresh, refresh_token: fresh.refresh_token ?? stored.refresh_token }
    void db
      .update(connections)
      .set({ tokens: encryptJson(merged) })
      .where(eq(connections.id, connection.id))
      .catch(() => {})
  })
  return oauth
}
