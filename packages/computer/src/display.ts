import { CLOUD_SCREEN, type ScreenshotPayload } from "@crew/shared"

import type { ActResult, BrowserControl, ComputerDriver, DesktopAction, PageAction } from "./driver"
import type { ComputerHandle } from "./provider"
import { CREW_DIR, TOOLCHAINS, WORKSPACE } from "./scripts"

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const BUTTON = { left: 1, middle: 2, right: 3 } as const
const SCROLL = { up: 4, down: 5, left: 6, right: 7 } as const
// Time for the UI to react before the screenshot
const SETTLE_S = 0.35

// xdotool key names for the common shortcuts models write
function normalizeKeys(keys: string) {
  return keys
    .split(/\s+/)
    .map((combo) =>
      combo
        .split("+")
        .map((k) => {
          const l = k.toLowerCase()
          if (l === "ctrl" || l === "control") return "ctrl"
          if (l === "cmd" || l === "command" || l === "meta" || l === "super") return "super"
          if (l === "enter" || l === "return") return "Return"
          if (l === "esc" || l === "escape") return "Escape"
          if (l === "backspace") return "BackSpace"
          if (l === "del" || l === "delete") return "Delete"
          if (l === "tab") return "Tab"
          if (l === "space") return "space"
          if (l === "pageup") return "Page_Up"
          if (l === "pagedown") return "Page_Down"
          if (["up", "down", "left", "right", "home", "end"].includes(l)) return l[0]!.toUpperCase() + l.slice(1)
          return k
        })
        .join("+"),
    )
    .join(" ")
}

// Drives one bot's X display (:n) on the shared cloud computer. A batch of
// actions and the screenshot after it happen in a single exec round trip.
export class CloudDisplayDriver implements ComputerDriver {
  readonly kind = "cloud" as const

  constructor(
    private computer: ComputerHandle,
    private display: number,
  ) {}

  readonly browser: BrowserControl = {
    read: (maxChars = 20_000) => this.page("read", String(maxChars)),
    controls: () => this.page("controls"),
    act: (action: PageAction) => this.page("act", JSON.stringify(action)),
  }

  // Runs one browser.py command against this bot's Chrome and parses its JSON
  private async page(command: string, arg?: string): Promise<unknown> {
    const r = await this.computer.exec(
      `(${TOOLCHAINS.playwright}) >/dev/null 2>&1; python3 ${CREW_DIR}/browser.py ${command} ${this.display}${arg === undefined ? "" : ` ${q(arg)}`}`,
      { timeoutMs: 60_000 },
    )
    if (r.exitCode !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "The browser didn't answer")
    return JSON.parse(r.stdout.trim().split("\n").pop() || "null")
  }

  private get env() {
    return `export DISPLAY=:${this.display};`
  }

  bash(command: string, opts: { timeoutMs?: number; cwd?: string } = {}) {
    return this.computer.exec(`${this.env} ${command}`, {
      timeoutMs: opts.timeoutMs ?? 120_000,
      cwd: opts.cwd ?? WORKSPACE,
    })
  }

  readFile(path: string) {
    return this.computer.readFile(this.resolve(path))
  }

  writeFile(path: string, content: string) {
    return this.computer.writeFile(this.resolve(path), content)
  }

  listFiles(path: string) {
    return this.computer.listFiles(this.resolve(path))
  }

  private resolve(path: string) {
    return path.startsWith("/") ? path : `${WORKSPACE}/${path}`
  }

  private async shot(prefix: string): Promise<{ shot: ScreenshotPayload; prefixOutput: string }> {
    const file = `/tmp/crew-shot-${this.display}.jpg`
    const r = await this.computer.exec(
      `${this.env} ${prefix} scrot -o -q 70 ${file} >/dev/null 2>&1 && echo && base64 -w0 ${file}`,
      { timeoutMs: 60_000 },
    )
    const lines = r.stdout.trim().split("\n")
    const base64 = lines.pop()
    if (r.exitCode !== 0 || !base64) throw new Error(`Screenshot failed: ${r.stderr || "no output"}`)
    return {
      shot: { base64, mediaType: "image/jpeg", width: CLOUD_SCREEN.width, height: CLOUD_SCREEN.height },
      prefixOutput: lines.join("\n"),
    }
  }

  async screenshot() {
    return (await this.shot("")).shot
  }

  private command(action: DesktopAction): string {
    const xd = (args: string) => `xdotool ${args}`
    switch (action.type) {
      case "click":
        return xd(
          `mousemove ${Math.round(action.x)} ${Math.round(action.y)} click ${action.double ? "--repeat 2 --delay 80 " : ""}${BUTTON[action.button ?? "left"]}`,
        )
      case "move":
        return xd(`mousemove ${Math.round(action.x)} ${Math.round(action.y)}`)
      case "drag":
        return xd(
          `mousemove ${Math.round(action.fromX)} ${Math.round(action.fromY)} mousedown 1 mousemove --sync ${Math.round(action.toX)} ${Math.round(action.toY)} mouseup 1`,
        )
      case "scroll":
        return xd(
          `mousemove ${Math.round(action.x)} ${Math.round(action.y)} click --repeat ${Math.min(Math.max(action.amount ?? 3, 1), 20)} ${SCROLL[action.direction]}`,
        )
      case "type":
        return xd(`type --delay 12 -- ${q(action.text)}`)
      case "key":
        return xd(`key -- ${normalizeKeys(action.keys)}`)
      case "wait":
        return `sleep ${Math.min(Math.max(action.ms, 0), 5000) / 1000}`
    }
  }

  // The whole batch and the screenshot after it are one exec round trip. Each
  // action that succeeds bumps a counter, so a failure says how far it got.
  async act(actions: DesktopAction[]): Promise<ActResult> {
    const steps = actions.map((a, i) => `${this.command(a)} && n=${i + 1}`).join(" && sleep 0.15 && ")
    const { shot, prefixOutput } = await this.shot(`n=0; { ${steps}; } >/dev/null 2>&1; sleep ${SETTLE_S}; echo "done=$n";`)
    const completed = Number(/done=(\d+)/.exec(prefixOutput)?.[1] ?? 0)
    const failed = actions[completed]
    return {
      ...shot,
      completed,
      ...(failed ? { error: `The ${failed.type} action didn't work` } : {}),
    }
  }

  async openUrl(url: string) {
    const r = await this.computer.exec(`python3 ${CREW_DIR}/browser.py launch ${this.display} ${q(url)}`, {
      timeoutMs: 60_000,
    })
    if (r.exitCode !== 0) throw new Error(r.stderr || "Could not open the browser")
    return `Opened ${url} in the browser on your screen.`
  }

  async openApp(name: string) {
    await this.computer.exec(`${this.env} nohup ${q(name)} >/dev/null 2>&1 &`, { timeoutMs: 10_000 })
    return `Started ${name}.`
  }

  async saveLogins() {
    const r = await this.computer.exec(`python3 ${CREW_DIR}/browser.py save ${this.display}`, { timeoutMs: 60_000 })
    if (r.exitCode !== 0) throw new Error(r.stderr || "Could not save logins")
    return JSON.parse(r.stdout.trim().split("\n").pop() || "[]") as string[]
  }
}
