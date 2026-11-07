import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { logger } from "hono/logger"

import { auth } from "./lib/auth"
import { botRoutes } from "./routes/bots"
import { connectorRoutes, firstPartyMcpRoutes, oauthRoutes } from "./routes/connectors"
import { deviceRoutes } from "./routes/devices"
import { inboxRoutes } from "./routes/inbox"
import { memoryRoutes } from "./routes/memories"
import { scheduleRoutes } from "./routes/schedules"
import { searchRoutes } from "./routes/search"
import { settingsRoutes } from "./routes/settings"
import { deviceMcpRoutes, deviceSocketRoutes, eventRoutes, screenRoutes } from "./routes/sockets"
import { runRoutes, threadRoutes } from "./routes/threads"

export const app = new Hono()
  .use(logger())
  // The app sends a bearer token, never cookies, so any origin is fine
  .use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"], exposeHeaders: ["set-auth-token"] }))
  .get("/health", (c) => c.json({ ok: true }))
  .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
  .route("/", oauthRoutes)
  .route("/mcp", firstPartyMcpRoutes)
  .route("/internal/devices", deviceMcpRoutes)
  .route("/devices/connect", deviceSocketRoutes)
  .route("/screen", screenRoutes)
  .route("/events", eventRoutes)
  .route("/bots", botRoutes)
  .route("/threads", threadRoutes)
  .route("/runs", runRoutes)
  .route("/inbox", inboxRoutes)
  .route("/connectors", connectorRoutes)
  .route("/devices", deviceRoutes)
  .route("/memories", memoryRoutes)
  .route("/schedules", scheduleRoutes)
  .route("/search", searchRoutes)
  .route("/", settingsRoutes)
  .onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: err instanceof Error ? err.message : "Something went wrong" }, 500)
  })

export type AppType = typeof app
