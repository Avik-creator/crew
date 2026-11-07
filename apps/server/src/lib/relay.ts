import { randomUUID } from "node:crypto"

import { bots, db, deviceActions, devices, runs, type McpServer } from "@crew/db"
import { deviceToServerSchema, type LocalToolName, type ServerToDevice } from "@crew/shared"
import { and, eq } from "drizzle-orm"
import type { WSContext } from "hono/ws"

import { publish } from "./bus"
import { runner } from "./runner"

type Pending = { deviceId: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
type Socket = { ws: WSContext; userId: string }

export type InvokeRequest = {
  userId: string
  runId: string
  botId: string
  botName: string
  tool: LocalToolName
  input: Record<string, unknown>
  background: boolean
}

const OFFLINE = "That computer is offline. Open Crew on it to let bots use it."

// Long commands get their own timeout; everything else should be quick
const timeoutFor = (req: Pick<InvokeRequest, "tool" | "input">) =>
  req.tool === "bash" ? Math.min(Number(req.input.timeoutMs ?? 120_000), 600_000) + 15_000 : 90_000

// Connects bot turns to the desktop app on someone's Mac.
// The app dials in over a WebSocket; tool calls and MCP frames ride on it.
export class DeviceRelay {
  private sockets = new Map<string, Socket>()
  private pending = new Map<string, Pending>()
  // MCP session id → the task-side socket waiting for frames
  private mcp = new Map<string, { deviceId: string; ws: WSContext }>()

  isOnline(deviceId: string) {
    return this.sockets.has(deviceId)
  }

  async attach(deviceId: string, userId: string, ws: WSContext) {
    this.sockets.get(deviceId)?.ws.close(4000, "Replaced by a newer connection")
    this.sockets.set(deviceId, { ws, userId })
    await db.update(devices).set({ status: "online", lastSeenAt: new Date() }).where(eq(devices.id, deviceId))
    publish(userId, { type: "device.status", deviceId, status: "online" })
  }

  async detach(deviceId: string, ws: WSContext) {
    const current = this.sockets.get(deviceId)
    if (current?.ws !== ws) return
    this.sockets.delete(deviceId)
    for (const [id, s] of this.mcp) {
      if (s.deviceId === deviceId) {
        s.ws.close(1011, "The computer went offline")
        this.mcp.delete(id)
      }
    }
    // Calls in flight on it won't get an answer now
    for (const [id, p] of this.pending) {
      if (p.deviceId !== deviceId) continue
      clearTimeout(p.timer)
      this.pending.delete(id)
      p.reject(new Error(OFFLINE))
    }
    await db.update(devices).set({ status: "offline", lastSeenAt: new Date() }).where(eq(devices.id, deviceId))
    publish(current.userId, { type: "device.status", deviceId, status: "offline" })
  }

  // The device was unlinked: forget its socket and hang up
  async drop(deviceId: string) {
    const s = this.sockets.get(deviceId)
    if (!s) return
    await this.detach(deviceId, s.ws)
    s.ws.close(4001, "This computer was unlinked")
  }

  private send(deviceId: string, frame: ServerToDevice) {
    const s = this.sockets.get(deviceId)
    if (!s) throw new Error(OFFLINE)
    s.ws.send(JSON.stringify(frame))
  }

  async handle(deviceId: string, raw: string) {
    let frame
    try {
      frame = deviceToServerSchema.parse(JSON.parse(raw))
    } catch (err) {
      console.warn(`Dropped a malformed frame from device ${deviceId}:`, err instanceof Error ? err.message : err)
      return
    }
    switch (frame.type) {
      case "ping":
        return this.send(deviceId, { type: "pong" })
      case "hello":
        await db
          .update(devices)
          .set({
            appVersion: frame.appVersion,
            platform: frame.platform,
            capabilities: frame.capabilities,
            allowedPaths: frame.allowedPaths,
            lastSeenAt: new Date(),
          })
          .where(eq(devices.id, deviceId))
        return
      case "result": {
        const p = this.pending.get(frame.id)
        if (!p) return
        clearTimeout(p.timer)
        this.pending.delete(frame.id)
        return frame.ok ? p.resolve(frame.output) : p.reject(new Error(frame.error ?? "The computer reported an error"))
      }
      case "progress":
        return
      case "audit":
        await db.insert(deviceActions).values({
          deviceId,
          runId: frame.runId,
          botId: frame.botId,
          tool: frame.tool,
          inputSummary: frame.inputSummary.slice(0, 500),
          decision: frame.decision,
          exitCode: frame.exitCode,
          durationMs: Math.round(frame.durationMs),
        })
        return
      case "mcp_frame":
        return this.mcp.get(frame.sessionId)?.ws.send(JSON.stringify(frame.frame))
      case "mcp_closed": {
        const s = this.mcp.get(frame.sessionId)
        this.mcp.delete(frame.sessionId)
        return s?.ws.close(frame.error ? 1011 : 1000, frame.error?.slice(0, 120))
      }
      case "kill": {
        // The person hit the kill switch on their Mac: stop the run everywhere,
        // as long as it's their run working on this Mac
        const userId = this.sockets.get(deviceId)?.userId
        if (!userId) return
        const [run] = await db
          .select({ id: runs.id })
          .from(runs)
          .innerJoin(bots, eq(bots.id, runs.botId))
          .where(and(eq(runs.id, frame.runId), eq(runs.userId, userId), eq(bots.deviceId, deviceId)))
        if (run) await runner.cancel(run.id).catch(() => {})
        return
      }
    }
  }

  invoke(deviceId: string, { userId, ...req }: InvokeRequest): Promise<unknown> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      // A bot only ever works on a Mac its own person linked
      const owner = this.sockets.get(deviceId)?.userId
      if (owner && owner !== userId) return reject(new Error(OFFLINE))
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${req.tool} took too long on the computer`))
      }, timeoutFor(req))
      this.pending.set(id, { deviceId, resolve, reject, timer })
      try {
        this.send(deviceId, { type: "invoke", id, ...req })
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err as Error)
      }
    })
  }

  // A run was stopped: the Mac ends whatever it is still running for it
  cancel(deviceId: string, runId: string) {
    try {
      this.send(deviceId, { type: "cancel", runId })
    } catch {
      // Offline: there is no way to reach it
    }
  }

  // Starts a local-command MCP server on the Mac and binds it to a task socket
  openMcp(server: McpServer, ws: WSContext) {
    if (!server.deviceId || !server.command) throw new Error("Not a local-command connector")
    const sessionId = randomUUID()
    this.mcp.set(sessionId, { deviceId: server.deviceId, ws })
    this.send(server.deviceId, {
      type: "mcp_open",
      sessionId,
      serverId: server.id,
      command: server.command,
      args: server.args ?? [],
      envKeys: server.envKeys ?? [],
    })
    return sessionId
  }

  mcpFrame(sessionId: string, frame: unknown) {
    const s = this.mcp.get(sessionId)
    if (s) this.send(s.deviceId, { type: "mcp_frame", sessionId, frame })
  }

  closeMcp(sessionId: string) {
    const s = this.mcp.get(sessionId)
    if (!s) return
    this.mcp.delete(sessionId)
    try {
      this.send(s.deviceId, { type: "mcp_close", sessionId })
    } catch {
      // Device already gone
    }
  }
}

export const relay = new DeviceRelay()
