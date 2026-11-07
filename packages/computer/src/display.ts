import { CLOUD_SCREEN, type ScreenshotPayload } from "@crew/shared"

import type { ActResult, AppAction, AppControl, AppSnapshotOptions, BrowserControl, ComputerDriver, DesktopAction, PageAction } from "./driver"
import type { ComputerHandle } from "./provider"
import { CREW_DIR, TOOLCHAINS, WORKSPACE } from "./scripts"

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

const BUTTON = { left: 1, middle: 2, right: 3 } as const
const SCROLL = { up: 4, down: 5, left: 6, right: 7 } as const
// Time for the UI to react before the screenshot
const SETTLE_S = 0.35
// What models call the apps on the cloud computer, and the program for each
const APP_ALIASES: Record<string, string> = {
  terminal: "xfce4-terminal",
  "xfce terminal": "xfce4-terminal",
  "text editor": "mousepad",
  editor: "mousepad",
  textedit: "mousepad",
  notepad: "mousepad",
  gedit: "mousepad",
  files: "thunar",
  "file manager": "thunar",
  finder: "thunar",
  calculator: "galculator",
}
const program = (name: string) => APP_ALIASES[name.trim().toLowerCase()] ?? name.trim()
// The browser always starts through browser.py, with the bot's profile and logins
const BROWSER_NAMES = new Set(["browser", "web browser", "chrome", "google chrome", "google-chrome", "chromium", "chromium-browser"])
const KNOWN_APPS = "xfce4-terminal (terminal), mousepad (text editor), thunar (files), galculator (calculator), browser"

// The display's session bus, which its apps found the same way: the
// accessibility tree is reached through it
const SESSION_BUS = `eval "$(dbus-launch --autolaunch=$(cat /etc/machine-id) --sh-syntax 2>/dev/null)";`

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

  readonly apps: AppControl = {
    listApps: () => this.appsPy("list"),
    snapshot: (opts: AppSnapshotOptions) => this.appsPy("read", { ...opts, app: program(opts.app) }),
    act: (action: AppAction) =>
      this.appsPy("act", action.type === "press" ? { ...action, keys: normalizeKeys(action.keys), app: action.app && program(action.app) } : action),
  }

  // Runs one apps.py command on this display and parses its JSON
  private async appsPy(command: string, arg?: object): Promise<unknown> {
    const r = await this.computer.exec(
      `(${TOOLCHAINS.atspi}) >/tmp/crew-atspi.log 2>&1; ${this.env} ${SESSION_BUS} python3 ${CREW_DIR}/apps.py ${command} ${this.display}${arg ? ` ${q(JSON.stringify(arg))}` : ""}`,
      { timeoutMs: 90_000 },
    )
    if (r.exitCode !== 0) throw new Error(r.stderr.trim().split("\n").pop() || "The app didn't answer")
    return JSON.parse(r.stdout.trim().split("\n").pop() || "null")
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

  // Starts an app by its program name or a common name for it, and says so
  // plainly when there's no such program
  async openApp(name: string) {
    if (BROWSER_NAMES.has(name.trim().toLowerCase())) {
      const r = await this.computer.exec(`python3 ${CREW_DIR}/browser.py launch ${this.display} ''`, { timeoutMs: 60_000 })
      if (r.exitCode !== 0) throw new Error(r.stderr || "Could not open the browser")
      return 'The browser is open. Go to a page with openUrl. readApp with "browser" shows its own buttons, tabs and pop-ups.'
    }
    const bin = program(name)
    const r = await this.computer.exec(
      `command -v ${q(bin)} >/dev/null || exit 3; ${this.env} nohup ${q(bin)} >/dev/null 2>&1 & sleep 1.5`,
      { timeoutMs: 15_000 },
    )
    if (r.exitCode === 3) throw new Error(`There's no app called "${name}" here. Try one of: ${KNOWN_APPS}.`)
    return `Started ${bin}${bin === name ? "" : ` (${name})`}. Use readApp with "${bin}" to see it.`
  }

  async saveLogins() {
    const r = await this.computer.exec(`python3 ${CREW_DIR}/browser.py save ${this.display}`, { timeoutMs: 60_000 })
    if (r.exitCode !== 0) throw new Error(r.stderr || "Could not save logins")
    return JSON.parse(r.stdout.trim().split("\n").pop() || "[]") as string[]
  }
}
