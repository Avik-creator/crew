import type { LocalToolName, ScreenshotPayload } from "@crew/shared"

import type { ActResult, AppAction, AppControl, AppSnapshotOptions, ComputerDriver, DesktopAction } from "./driver"
import type { ExecResult, FileEntry } from "./provider"

export type DeviceRunContext = { userId: string; runId: string; botId: string; botName: string; background: boolean }

export type DeviceInvoke = (
  deviceId: string,
  req: DeviceRunContext & { tool: LocalToolName; input: Record<string, unknown> },
) => Promise<unknown>

// Turns run in the server, next to the device relay; the server plugs it in here
let relayInvoke: DeviceInvoke | undefined
export function setDeviceInvoker(fn: DeviceInvoke) {
  relayInvoke = fn
}

// Tells the Mac a run was stopped, so it ends what that run left running
export type DeviceCancel = (deviceId: string, runId: string) => void
let relayCancel: DeviceCancel | undefined
export function setDeviceCanceller(fn: DeviceCancel) {
  relayCancel = fn
}

const ACTION_TOOL: Record<Exclude<DesktopAction["type"], "wait">, LocalToolName> = {
  click: "mouseClick",
  move: "mouseMove",
  drag: "mouseDrag",
  scroll: "mouseScroll",
  type: "keyboardType",
  key: "keyboardPress",
}

// The person's own Mac, reached through the server's device relay. The app on
// the Mac enforces its own limits (allowed folders, kill switch, overlay).
export class DeviceDriver implements ComputerDriver {
  readonly kind = "device" as const
  readonly apps?: AppControl
  private used = false

  constructor(
    private deviceId: string,
    private ctx: DeviceRunContext,
    features: { apps?: boolean } = {},
    signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => this.used && relayCancel?.(deviceId, ctx.runId), { once: true })
    if (features.apps) {
      this.apps = {
        listApps: () => this.invoke("listApps", {}),
        snapshot: (opts: AppSnapshotOptions) => this.invoke("readApp", opts),
        act: (action: AppAction) => this.invoke("useApp", action),
      }
    }
  }

  private async invoke<T>(tool: LocalToolName, input: Record<string, unknown>): Promise<T> {
    if (!relayInvoke) throw new Error("The device relay isn't running in this process")
    this.used = true
    return (await relayInvoke(this.deviceId, { ...this.ctx, tool, input })) as T
  }

  bash(command: string, opts: { timeoutMs?: number; cwd?: string } = {}) {
    return this.invoke<ExecResult>("bash", { command, ...opts })
  }

  readFile(path: string) {
    return this.invoke<string>("readFile", { path })
  }

  async writeFile(path: string, content: string) {
    await this.invoke("writeFile", { path, content })
  }

  listFiles(path: string) {
    return this.invoke<FileEntry[]>("listFiles", { path })
  }

  screenshot() {
    return this.invoke<ScreenshotPayload>("viewScreen", {})
  }

  // One relay call per action. Only the last one asks for a screenshot; app
  // versions that don't know noShot send one anyway, and it's ignored.
  async act(actions: DesktopAction[]): Promise<ActResult> {
    let completed = 0
    let error: string | undefined
    let shot: ScreenshotPayload | undefined
    for (const [i, action] of actions.entries()) {
      try {
        if (action.type === "wait") {
          await new Promise((r) => setTimeout(r, Math.min(Math.max(action.ms, 0), 5000)))
        } else {
          const { type, ...input } = action
          const last = i === actions.length - 1
          const result = await this.invoke<ScreenshotPayload | null>(ACTION_TOOL[type], last ? input : { ...input, noShot: true })
          if (last && result?.base64) shot = result
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        break
      }
      completed++
    }
    return { ...(shot ?? (await this.screenshot())), completed, ...(error ? { error } : {}) }
  }

  openUrl(url: string) {
    return this.invoke<string>("openUrl", { url })
  }

  openApp(name: string) {
    return this.invoke<string>("openApp", { name })
  }
}
