import type { LocalToolName, ScreenshotPayload } from "@crew/shared"

import type { AppAction, AppControl, AppSnapshotOptions, ComputerDriver, DesktopAction } from "./driver"
import type { ExecResult, FileEntry } from "./provider"

export type DeviceRunContext = { runId: string; botId: string; botName: string; background: boolean }

export type DeviceInvoke = (
  deviceId: string,
  req: DeviceRunContext & { tool: LocalToolName; input: Record<string, unknown> },
) => Promise<unknown>

// Turns run in the server, next to the device relay; the server plugs it in here
let relayInvoke: DeviceInvoke | undefined
export function setDeviceInvoker(fn: DeviceInvoke) {
  relayInvoke = fn
}

const ACTION_TOOL: Record<DesktopAction["type"], LocalToolName> = {
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

  constructor(
    private deviceId: string,
    private ctx: DeviceRunContext,
    features: { apps?: boolean } = {},
  ) {
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

  act(action: DesktopAction) {
    const { type, ...input } = action
    return this.invoke<ScreenshotPayload>(ACTION_TOOL[type], input)
  }

  openUrl(url: string) {
    return this.invoke<string>("openUrl", { url })
  }

  openApp(name: string) {
    return this.invoke<string>("openApp", { name })
  }
}
