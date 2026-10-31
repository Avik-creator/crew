import { getScreenUpstream, touchComputer } from "@crew/computer"
import type { Device } from "@crew/db"
import { connectionWithServer } from "@crew/mcp"
import { verifyToken } from "@crew/shared/node"
import { upgradeWebSocket } from "@hono/node-server"
import { Hono } from "hono"
import { createMiddleware } from "hono/factory"
import { streamSSE } from "hono/streaming"
import type { WSContext } from "hono/ws"
import WebSocket from "ws"

import { subscribe } from "../lib/bus"
import { requireUser, type AppEnv } from "../lib/http"
import { relay } from "../lib/relay"
import { deviceFromToken } from "./devices"

const toText = (data: unknown) =>
  typeof data === "string" ? data : new TextDecoder().decode(data instanceof ArrayBuffer ? data : (data as Uint8Array))

const toBuffer = (data: unknown) =>
  typeof data === "string" ? data : data instanceof ArrayBuffer ? Buffer.from(data) : Buffer.from(data as Uint8Array)

// Live events for the app, one stream per open window
export const eventRoutes = new Hono<AppEnv>().use(requireUser).get("/", (c) => {
  const user = c.get("user")
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribe(user.id, (event) => {
      void stream.writeSSE({ event: "app", data: JSON.stringify(event) })
    })
    stream.onAbort(unsubscribe)
    await stream.writeSSE({ event: "ready", data: "{}" })
    while (!stream.aborted) {
      await stream.sleep(25_000)
      await stream.writeSSE({ event: "ping", data: "{}" })
    }
    unsubscribe()
  })
})

type ScreenTicket = { uid: string; display: number }

// The live screen: the app's noVNC client talks to us, we talk to the
// computer's websockify with the provider's access header. Sandbox URLs and
// tokens never reach the app.
export const screenRoutes = new Hono<{ Variables: { ticket: ScreenTicket } }>().get(
  "/",
  createMiddleware<{ Variables: { ticket: ScreenTicket } }>(async (c, next) => {
    const ticket = verifyToken<ScreenTicket>(c.req.query("ticket"))
    if (!ticket) return c.text("Ticket expired", 401)
    c.set("ticket", ticket)
    await next()
  }),
  upgradeWebSocket(async (c) => {
    const { uid, display } = c.get("ticket")
    const upstreamInfo = await getScreenUpstream(uid, display)
    let upstream: WebSocket | undefined
    const queue: Buffer[] = []
    let alive: NodeJS.Timeout | undefined
    return {
      onOpen(_evt, ws) {
        upstream = new WebSocket(upstreamInfo.url, ["binary"], { headers: upstreamInfo.headers })
        upstream.binaryType = "nodebuffer"
        upstream.on("open", () => {
          for (const b of queue.splice(0)) upstream!.send(b)
        })
        upstream.on("message", (data: Buffer) => ws.send(new Uint8Array(data)))
        upstream.on("close", () => ws.close(1000, "Screen closed"))
        upstream.on("error", () => ws.close(1011, "Screen unavailable"))
        // Someone watching counts as activity, so the computer stays awake
        alive = setInterval(() => void touchComputer(uid), 60_000)
      },
      onMessage(evt) {
        const data = toBuffer(evt.data) as Buffer
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(data)
        else queue.push(data)
      },
      onClose() {
        clearInterval(alive)
        upstream?.close()
      },
    }
  }),
)

// The desktop app on someone's Mac dials in here with its device token
export const deviceSocketRoutes = new Hono<{ Variables: { device: Device } }>().get(
  "/",
  createMiddleware<{ Variables: { device: Device } }>(async (c, next) => {
    const device = await deviceFromToken(c.req.header("authorization")?.replace(/^Bearer /, ""))
    if (!device) return c.text("Unknown device", 401)
    c.set("device", device)
    await next()
  }),
  upgradeWebSocket((c) => {
    const device = c.get("device")
    return {
      onOpen(_evt, ws) {
        void relay.attach(device.id, device.userId, ws)
      },
      onMessage(evt) {
        void relay.handle(device.id, toText(evt.data))
      },
      onClose(_evt, ws) {
        void relay.detach(device.id, ws)
      },
    }
  }),
)

type McpClaims = { cid: string }

// A bot turn reaching a local-command MCP server on someone's Mac. Frames are
// JSON-RPC messages, relayed as-is through the device socket.
export const deviceMcpRoutes = new Hono<{ Variables: { claims: McpClaims } }>().get(
  "/:id/mcp",
  createMiddleware<{ Variables: { claims: McpClaims } }>(async (c, next) => {
    const claims = verifyToken<McpClaims>(c.req.query("token"))
    if (!claims) return c.text("Unauthorized", 401)
    c.set("claims", claims)
    await next()
  }),
  upgradeWebSocket(async (c) => {
    const row = await connectionWithServer(c.get("claims").cid)
    const deviceId = c.req.param("id")
    let sessionId: string | undefined
    return {
      onOpen(_evt, ws: WSContext) {
        if (!row || row.server.deviceId !== deviceId) return ws.close(1008, "Not allowed")
        try {
          sessionId = relay.openMcp(row.server, ws)
        } catch (err) {
          ws.close(1011, (err instanceof Error ? err.message : "Unavailable").slice(0, 120))
        }
      },
      onMessage(evt) {
        if (!sessionId) return
        try {
          relay.mcpFrame(sessionId, JSON.parse(toText(evt.data)))
        } catch {
          // Ignore malformed frames
        }
      },
      onClose() {
        if (sessionId) relay.closeMcp(sessionId)
      },
    }
  }),
)
