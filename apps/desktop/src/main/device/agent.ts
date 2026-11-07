import { execFile, type ChildProcess } from "node:child_process"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import {
  serverToDeviceSchema,
  type AppAction,
  type AppSnapshotOptions,
  type DeviceCapabilities,
  type DeviceToServer,
  type ServerToDevice,
} from "@crew/shared"
import { app, shell, systemPreferences } from "electron"
import WebSocket from "ws"

import { hideOverlay, showOverlay } from "../overlay"
import { secureStore, serverUrl } from "../store"
import { apps, findAgentDesktop, installAgentDesktop } from "./apps"
import { input } from "./input"
import { McpSessions } from "./mcp"
import { assertAllowed } from "./paths"
import { captureScreen, type ScreenGeometry } from "./screen"
import { bash, killTree } from "./shell"

const run = promisify(execFile)
// Stopped runs are remembered so their late calls are turned down; old ones are forgotten
const KILLED_CAP = 200
// The kill switch stops every run that used this Mac since the last kill, up to the most recent ones
const ACTIVE_CAP = 200

type Invoke = Extract<ServerToDevice, { type: "invoke" }>
export type DeviceStatus = { linked: boolean; online: boolean; name?: string; deviceId?: string; error?: string; appsError?: string }

// Runs bots' tool calls on this Mac. Dials out to the server (nothing listens
// locally), reconnects with backoff, and honours the kill switch.
export class DeviceAgent {
  private ws?: WebSocket
  private retry = 0
  private timer?: NodeJS.Timeout
  private ping?: NodeJS.Timeout
  private stopped = false
  private geometry?: ScreenGeometry
  private killed = new Set<string>()
  // Runs that used this Mac since the last kill, oldest use first, with their calls in flight
  private activeRuns = new Map<string, number>()
  private children = new Map<string, Set<ChildProcess>>()
  private mcp = new McpSessions((f) => this.send(f))
  status: DeviceStatus = { linked: false, online: false }
  // Whether agent-desktop is installed; set up when the connection opens
  private appsReady = false

  constructor(private onStatus: (s: DeviceStatus) => void) {}

  private setStatus(patch: Partial<DeviceStatus>) {
    this.status = { ...this.status, ...patch }
    this.onStatus(this.status)
  }

  capabilities(): DeviceCapabilities {
    const mac = process.platform === "darwin"
    return {
      shell: true,
      files: true,
      screen: !mac || systemPreferences.getMediaAccessStatus("screen") === "granted",
      input: !mac || systemPreferences.isTrustedAccessibilityClient(false),
      stdioMcp: true,
      apps: this.appsReady,
    }
  }

  // Looks for agent-desktop, downloading it when asked, and tells the server
  // if that changed
  async refreshApps(install = false) {
    let ready = !!(await findAgentDesktop())
    if (!ready && install) {
      ready = await installAgentDesktop().then(
        () => true,
        (err: unknown) => {
          this.setStatus({ appsError: err instanceof Error ? err.message : String(err) })
          return false
        },
      )
      if (ready) this.setStatus({ appsError: undefined })
    }
    if (ready === this.appsReady) return ready
    this.appsReady = ready
    this.refreshHello()
    return ready
  }

  start() {
    const device = secureStore().get("device")
    this.stopped = false
    this.setStatus({ linked: !!device, name: device?.name, deviceId: device?.id })
    if (!device) return
    clearTimeout(this.timer)
    const url = `${serverUrl().replace(/^http/, "ws")}/devices/connect`
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${device.token}` } })
    this.ws = ws
    // A restart opens a new socket before the old one finishes closing; the
    // old one's events must not touch the new connection
    const current = () => this.ws === ws
    ws.on("open", () => {
      if (!current()) return ws.close()
      this.retry = 0
      this.setStatus({ online: true, error: undefined })
      this.send({
        type: "hello",
        appVersion: app.getVersion(),
        platform: process.platform,
        capabilities: this.capabilities(),
        allowedPaths: secureStore().get("allowedPaths") ?? [],
      })
      this.ping = setInterval(() => this.send({ type: "ping" }), 25_000)
      void this.refreshApps(true)
    })
    ws.on("message", (raw) => void this.onFrame(String(raw)))
    ws.on("unexpected-response", (_req, res) => {
      if (current() && res.statusCode === 401) {
        this.setStatus({ error: "This Mac was unlinked. Link it again in Settings." })
        this.stopped = true
      }
    })
    ws.on("close", () => {
      if (!current()) return
      clearInterval(this.ping)
      this.mcp.closeAll()
      this.setStatus({ online: false })
      if (!this.stopped) {
        const delay = Math.min(30_000, 1000 * 2 ** this.retry++)
        this.timer = setTimeout(() => this.start(), delay)
      }
    })
    ws.on("error", () => {})
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    clearInterval(this.ping)
    this.ws?.close()
    this.ws = undefined
    this.mcp.closeAll()
    this.setStatus({ online: false })
  }

  restart() {
    this.stop()
    this.start()
  }

  // Sends "hello" again so the server learns new folders or permissions
  refreshHello() {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.send({
      type: "hello",
      appVersion: app.getVersion(),
      platform: process.platform,
      capabilities: this.capabilities(),
      allowedPaths: secureStore().get("allowedPaths") ?? [],
    })
  }

  // ⌘⇧Esc: stop every run that is using this Mac
  kill() {
    for (const runId of this.activeRuns.keys()) {
      this.stopRun(runId)
      this.send({ type: "kill", runId })
    }
    this.activeRuns.clear()
    hideOverlay()
  }

  // Turns down the run's later calls and ends the commands it has running
  private stopRun(runId: string) {
    this.killed.delete(runId)
    this.killed.add(runId)
    if (this.killed.size > KILLED_CAP) this.killed.delete(this.killed.values().next().value!)
    for (const child of this.children.get(runId) ?? []) killTree(child)
  }

  // Moves the run to the newest end; past the cap, the least recently used idle run is forgotten
  private useRun(runId: string, delta: number) {
    const busy = (this.activeRuns.get(runId) ?? 0) + delta
    this.activeRuns.delete(runId)
    this.activeRuns.set(runId, busy)
    if (this.activeRuns.size <= ACTIVE_CAP) return
    for (const [id, n] of this.activeRuns) {
      if (n) continue
      this.activeRuns.delete(id)
      return
    }
  }

  private track(runId: string, child: ChildProcess) {
    const set = this.children.get(runId) ?? new Set()
    this.children.set(runId, set.add(child))
    return () => {
      set.delete(child)
      if (!set.size) this.children.delete(runId)
    }
  }

  private send(frame: DeviceToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  private async onFrame(raw: string) {
    const parsed = serverToDeviceSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return
    const frame = parsed.data
    switch (frame.type) {
      case "invoke":
        return this.invoke(frame)
      case "mcp_open": {
        const env = secureStore().get("mcpEnv")?.[frame.serverId] ?? {}
        const missing = frame.envKeys.filter((k) => !env[k])
        if (missing.length) {
          return this.send({ type: "mcp_closed", sessionId: frame.sessionId, error: `Set ${missing.join(", ")} in Crew on this Mac` })
        }
        return this.mcp.open({ sessionId: frame.sessionId, command: frame.command, args: frame.args, env })
      }
      case "mcp_frame":
        return this.mcp.frame(frame.sessionId, frame.frame)
      case "mcp_close":
        return this.mcp.close(frame.sessionId)
      case "cancel":
        this.stopRun(frame.runId)
        return
      case "pong":
        return
    }
  }

  private async invoke(frame: Invoke) {
    const started = Date.now()
    if (this.killed.has(frame.runId)) {
      return this.send({ type: "result", id: frame.id, ok: false, error: "Stopped by the person with the kill switch." })
    }
    this.useRun(frame.runId, 1)
    let exitCode: number | null = null
    try {
      const output = await this.execute(frame)
      if (frame.tool === "bash") exitCode = (output as { exitCode: number }).exitCode
      this.send({ type: "result", id: frame.id, ok: true, output })
    } catch (err) {
      this.send({ type: "result", id: frame.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (this.activeRuns.has(frame.runId)) this.useRun(frame.runId, -1)
      this.send({
        type: "audit",
        runId: frame.runId,
        botId: frame.botId,
        tool: frame.tool,
        inputSummary: JSON.stringify(frame.input).slice(0, 300),
        decision: "auto",
        exitCode,
        durationMs: Date.now() - started,
      })
    }
  }

  private async screenshot() {
    const { shot, geometry } = await captureScreen()
    this.geometry = geometry
    return shot
  }

  private async scale() {
    if (!this.geometry) await this.screenshot()
    return this.geometry!.scale
  }

  private async execute({ tool, input: args, botName, runId }: Invoke): Promise<unknown> {
    const allowed = secureStore().get("allowedPaths") ?? []
    const a = args as Record<string, any>
    const act = async (fn: (scale: number) => Promise<void>) => {
      if (!this.capabilities().input) {
        throw new Error("Crew can't control the mouse and keyboard. Allow Accessibility for Crew in System Settings → Privacy & Security.")
      }
      showOverlay(botName)
      await fn(await this.scale())
      // In a batch, only the last action needs a look at the result
      if (a.noShot) {
        await new Promise((r) => setTimeout(r, 150))
        return null
      }
      await new Promise((r) => setTimeout(r, 350))
      return this.screenshot()
    }
    switch (tool) {
      case "bash":
        return bash(String(a.command), Number(a.timeoutMs ?? 120_000), a.cwd, (child) => this.track(runId, child))
      case "readFile":
        return readFile(assertAllowed(a.path, allowed), "utf8")
      case "writeFile": {
        const target = assertAllowed(a.path, allowed)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, String(a.content))
        return `Saved ${target}`
      }
      case "listFiles": {
        const dir = assertAllowed(a.path, allowed)
        const entries = await readdir(dir, { withFileTypes: true })
        return Promise.all(
          entries.slice(0, 500).map(async (e) => ({
            name: e.name,
            path: join(dir, e.name),
            type: e.isDirectory() ? "dir" : "file",
            size: e.isDirectory() ? 0 : (await stat(join(dir, e.name)).catch(() => ({ size: 0 }))).size,
          })),
        )
      }
      case "viewScreen":
      case "showScreen":
        return this.screenshot()
      case "mouseClick":
        return act((s) => input.click(a.x, a.y, s, a.button, a.double))
      case "mouseMove":
        return act((s) => input.move(a.x, a.y, s))
      case "mouseDrag":
        return act((s) => input.drag(a.fromX, a.fromY, a.toX, a.toY, s))
      case "mouseScroll":
        return act((s) => input.scroll(a.x, a.y, s, a.direction, a.amount))
      case "keyboardType":
        return act(() => input.type(String(a.text)))
      case "keyboardPress":
        return act(() => input.press(String(a.keys)))
      case "openApp":
        await run("open", ["-a", String(a.name)])
        return `Opened ${a.name}`
      case "openUrl":
        await shell.openExternal(String(a.url))
        return `Opened ${a.url}`
      case "listApps":
        return apps.listApps()
      case "readApp":
        return apps.snapshot(a as AppSnapshotOptions)
      case "useApp": {
        // Accessibility actions don't move the pointer, but they still change
        // the person's apps, so they need the same permission and overlay
        if (!this.capabilities().input) {
          throw new Error("Crew can't control apps. Allow Accessibility for Crew in System Settings → Privacy & Security.")
        }
        showOverlay(botName)
        return apps.act(a as AppAction)
      }
    }
  }
}
