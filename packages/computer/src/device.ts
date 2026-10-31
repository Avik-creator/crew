import type { LocalToolName, ScreenshotPayload } from "@crew/shared"
import { internalFetch } from "@crew/shared/node"

import type { ComputerDriver, DesktopAction } from "./driver"
import type { ExecResult, FileEntry } from "./provider"

export type DeviceRunContext = { runId: string; botId: string; botName: string; background: boolean }

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

  constructor(
    private deviceId: string,
    private ctx: DeviceRunContext,
  ) {}

  private async invoke<T>(tool: LocalToolName, input: Record<string, unknown>): Promise<T> {
    const res = await internalFetch(`/internal/devices/${this.deviceId}/invoke`, {
      method: "POST",
      body: JSON.stringify({ ...this.ctx, tool, input }),
    })
    const data = (await res.json()) as { ok: true; output: T } | { ok: false; error: string }
    if (!data.ok) throw new Error(data.error)
    return data.output
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
