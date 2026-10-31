import { connections, db, devices, mcpServers, toolPrefs } from "@crew/db"
import {
  CATALOG,
  connectionWithServer,
  disconnect,
  finishConnect,
  firstParty,
  OAUTH_CALLBACK_PATH,
  refreshTools,
  saveSecrets,
  startConnect,
  staticClient,
} from "@crew/mcp"
import { DEEP_LINK_SCHEME } from "@crew/shared"
import { randomToken, verifyToken } from "@crew/shared/node"
import { json } from "../lib/validate"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { and, eq, or } from "drizzle-orm"
import { Hono } from "hono"
import { html } from "hono/html"
import { z } from "zod"

import { publish } from "../lib/bus"
import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"

async function visibleServer(userId: string, serverId: string) {
  const [s] = await db.select().from(mcpServers).where(eq(mcpServers.id, serverId))
  if (!s || (s.isCustom && s.addedByUserId !== userId)) notFound("That connector")
  return s
}

const customSchema = z.discriminatedUnion("transport", [
  z.object({
    transport: z.literal("http"),
    name: z.string().trim().min(1).max(50),
    description: z.string().max(200).optional().default(""),
    url: z.string().url(),
    authMode: z.enum(["oauth", "token", "none"]),
  }),
  z.object({
    transport: z.literal("stdio"),
    name: z.string().trim().min(1).max(50),
    description: z.string().max(200).optional().default(""),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    envKeys: z.array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/)).default([]),
    runOn: z.enum(["cloud_computer", "device"]),
    deviceId: z.string().optional(),
    template: z.string().optional(),
  }),
])

const slugify = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "server"}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`

export const connectorRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const servers = await db
      .select()
      .from(mcpServers)
      .where(or(eq(mcpServers.isCustom, false), eq(mcpServers.addedByUserId, user.id)))
    const conns = await db.select().from(connections).where(eq(connections.userId, user.id))
    return c.json({
      servers: servers.map((s) => {
        const conn = conns.find((x) => x.serverId === s.id)
        return {
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          icon: s.icon,
          transport: s.transport,
          url: s.url,
          command: s.command,
          args: s.args,
          envKeys: s.envKeys,
          runOn: s.runOn,
          deviceId: s.deviceId,
          authMode: s.authMode,
          isCustom: s.isCustom,
          // Its pre-registered OAuth app is missing from the server env
          needsSetup: !!s.staticClientEnv && !staticClient(s),
          connection: conn
            ? {
                id: conn.id,
                status: conn.status,
                error: conn.error,
                accountLabel: conn.accountLabel,
                toolCount: conn.toolsCache?.length ?? null,
                updatedAt: conn.updatedAt,
              }
            : null,
        }
      }),
      templates: CATALOG.filter((t) => t.template).map((t) => ({
        slug: t.slug,
        name: t.name,
        description: t.description,
        icon: t.icon,
        command: t.command,
        args: t.args,
        envKeys: t.envKeys ?? [],
        runOn: t.runOn,
      })),
    })
  })
  .post("/custom", json(customSchema), async (c) => {
    const user = c.get("user")
    const input = c.req.valid("json")
    if (input.transport === "stdio" && input.runOn === "device") {
      if (!input.deviceId) badRequest("Pick the computer this runs on.")
      const [d] = await db.select().from(devices).where(and(eq(devices.id, input.deviceId), eq(devices.userId, user.id)))
      if (!d) badRequest("That computer isn't linked to your account.")
    }
    const [server] = await db
      .insert(mcpServers)
      .values({
        slug: slugify(input.name),
        name: input.name,
        description: input.description,
        icon: input.transport === "stdio" ? (input.template ?? "terminal") : "plug",
        transport: input.transport,
        url: input.transport === "http" ? input.url : null,
        command: input.transport === "stdio" ? input.command : null,
        args: input.transport === "stdio" ? input.args : null,
        envKeys: input.transport === "stdio" ? input.envKeys : null,
        runOn: input.transport === "stdio" ? input.runOn : null,
        deviceId: input.transport === "stdio" && input.runOn === "device" ? input.deviceId : null,
        authMode: input.transport === "http" ? input.authMode : "none",
        isCustom: true,
        addedByUserId: user.id,
      })
      .returning()
    return c.json(server, 201)
  })
  .delete("/custom/:id", async (c) => {
    const user = c.get("user")
    const server = await visibleServer(user.id, c.req.param("id"))
    if (!server.isCustom) badRequest("Built-in connectors can only be disconnected.")
    await disconnect(user.id, server.id).catch(() => {})
    await db.delete(mcpServers).where(eq(mcpServers.id, server.id))
    return c.body(null, 204)
  })
  .post("/:id/connect", async (c) => {
    const user = c.get("user")
    const server = await visibleServer(user.id, c.req.param("id"))
    const result = await startConnect(user.id, server.id)
    return c.json(result)
  })
  .post(
    "/:id/secrets",
    json(z.object({ token: z.string().min(1).optional(), env: z.record(z.string(), z.string()).optional() })),
    async (c) => {
      const user = c.get("user")
      const server = await visibleServer(user.id, c.req.param("id"))
      await saveSecrets(user.id, server.id, c.req.valid("json"))
      return c.json({ ok: true })
    },
  )
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const server = await visibleServer(user.id, c.req.param("id"))
    await disconnect(user.id, server.id)
    return c.body(null, 204)
  })
  .get("/:id/tools", async (c) => {
    const user = c.get("user")
    const server = await visibleServer(user.id, c.req.param("id"))
    const [conn] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.userId, user.id), eq(connections.serverId, server.id)))
    const prefs = await db
      .select()
      .from(toolPrefs)
      .where(and(eq(toolPrefs.userId, user.id), eq(toolPrefs.serverId, server.id)))
    const hard = new Set(server.hardApprovalTools ?? [])
    return c.json(
      (conn?.toolsCache ?? []).map((t) => ({
        name: t.name,
        title: t.title ?? t.annotations?.title ?? t.name,
        description: t.description ?? "",
        readOnly: t.annotations?.readOnlyHint === true,
        hard: hard.has(t.name),
        mode: prefs.find((p) => p.toolName === t.name)?.mode ?? null,
      })),
    )
  })
  .post("/:id/refresh", async (c) => {
    const user = c.get("user")
    const server = await visibleServer(user.id, c.req.param("id"))
    const [conn] = await db
      .select()
      .from(connections)
      .where(and(eq(connections.userId, user.id), eq(connections.serverId, server.id)))
    if (!conn) badRequest("Connect it first.")
    const tools = await refreshTools(conn.id)
    return c.json({ toolCount: tools.length })
  })
  .put(
    "/:id/tools/:tool",
    json(z.object({ mode: z.enum(["always_allow", "always_ask"]).nullable() })),
    async (c) => {
      const user = c.get("user")
      const server = await visibleServer(user.id, c.req.param("id"))
      const toolName = c.req.param("tool")
      const { mode } = c.req.valid("json")
      if (mode === "always_allow" && server.hardApprovalTools?.includes(toolName)) {
        badRequest("This action always needs your OK.")
      }
      const where = and(eq(toolPrefs.userId, user.id), eq(toolPrefs.serverId, server.id), eq(toolPrefs.toolName, toolName))
      if (!mode) await db.delete(toolPrefs).where(where)
      else {
        await db
          .insert(toolPrefs)
          .values({ userId: user.id, serverId: server.id, toolName, mode })
          .onConflictDoUpdate({ target: [toolPrefs.userId, toolPrefs.serverId, toolPrefs.toolName], set: { mode } })
      }
      return c.json({ ok: true })
    },
  )

const page = (title: string, body: string, deepLink: string) => html`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${title}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font: 15px/1.5 -apple-system, system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0b0b0f; color: #ececf1; }
        main { text-align: center; max-width: 360px; padding: 24px; }
        h1 { font-size: 20px; margin: 0 0 8px; }
        p { color: #a1a1aa; margin: 0 0 20px; }
        a { color: #0b0b0f; background: #ececf1; padding: 8px 16px; border-radius: 8px; text-decoration: none; font-weight: 500; }
      </style>
    </head>
    <body>
      <main>
        <h1>${title}</h1>
        <p>${body}</p>
        <a href="${deepLink}">Back to Crew</a>
      </main>
      <script>setTimeout(() => { location.href = ${JSON.stringify(deepLink)} }, 600)</script>
    </body>
  </html>`

// Public: the provider redirects the browser here after sign-in
export const oauthRoutes = new Hono().get(OAUTH_CALLBACK_PATH, async (c) => {
  const { code, state, iss, error } = c.req.query()
  if (!state) return c.html(page("Something went wrong", "The sign-in link is missing information.", `${DEEP_LINK_SCHEME}://connections`), 400)
  try {
    const { server, connection } = await finishConnect({ code: code ?? "", state, iss, error })
    publish(connection.userId, { type: "connection.updated", connectionId: connection.id, status: "active" })
    const link = `${DEEP_LINK_SCHEME}://connections/done?server=${encodeURIComponent(server.slug)}`
    return c.html(page(`${server.name} is connected`, "Your bots can use it now. You can close this tab.", link))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.html(page("Couldn't connect", message, `${DEEP_LINK_SCHEME}://connections?error=1`), 400)
  }
})

// First-party MCP servers (e.g. Google), called by bot turns with a signed token.
// Stateless: a fresh server and transport per request.
export const firstPartyMcpRoutes = new Hono().all("/:slug", async (c) => {
  const claims = verifyToken<{ cid: string }>(c.req.header("authorization")?.replace(/^Bearer /, ""))
  if (!claims) return c.json({ error: "Unauthorized" }, 401)
  const row = await connectionWithServer(claims.cid)
  const connector = firstParty(c.req.param("slug"))
  if (!row || !connector || row.server.slug !== connector.slug) return c.json({ error: "Not found" }, 404)
  const server = connector.createServer(row.connection, row.server)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})
