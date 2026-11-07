import type { AppAction, AppSnapshotOptions, ScreenshotPayload } from "@crew/shared"

import type { ExecResult, FileEntry } from "./provider"

export type { AppAction, AppSnapshotOptions }

export type MouseButton = "left" | "right" | "middle"

export type DesktopAction =
  | { type: "click"; x: number; y: number; button?: MouseButton; double?: boolean }
  | { type: "move"; x: number; y: number }
  | { type: "drag"; fromX: number; fromY: number; toX: number; toY: number }
  | { type: "scroll"; x: number; y: number; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "type"; text: string }
  | { type: "key"; keys: string }
  | { type: "wait"; ms: number }

// What a batch of actions did, with one screenshot taken after the last one
export type ActResult = ScreenshotPayload & {
  completed: number
  // Why the action after the completed ones failed; later ones didn't run
  error?: string
}

// Reads and operates apps through the OS accessibility tree: elements come
// back with refs, so actions don't depend on pixel positions
export interface AppControl {
  listApps(): Promise<unknown>
  snapshot(opts: AppSnapshotOptions): Promise<unknown>
  act(action: AppAction): Promise<unknown>
}

// One step on the open web page, aimed at a ref from the latest pageControls
export type PageAction =
  | { type: "click"; ref: string }
  | { type: "fill"; ref: string; text: string; submit?: boolean }
  | { type: "select"; ref: string; option: string }
  | { type: "press"; key: string }
  | { type: "goto"; url: string }
  | { type: "back" }
  | { type: "scroll"; direction: "up" | "down" }

// The browser on the computer, used through the page's DOM: exact text and
// link URLs, and controls by ref. Faster and more exact than screenshots for
// anything on the web.
export interface BrowserControl {
  read(maxChars?: number): Promise<unknown>
  controls(): Promise<unknown>
  act(action: PageAction): Promise<unknown>
}

// What every computer tool talks to, whether the bot works on the shared cloud
// computer (CloudDisplayDriver) or on the person's own Mac (DeviceDriver).
export interface ComputerDriver {
  readonly kind: "cloud" | "device"
  bash(command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<ExecResult>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  listFiles(path: string): Promise<FileEntry[]>
  screenshot(): Promise<ScreenshotPayload>
  // Runs the actions in order, stopping at the first that fails, and returns
  // a screenshot of the result
  act(actions: DesktopAction[]): Promise<ActResult>
  openUrl(url: string): Promise<string>
  openApp?(name: string): Promise<string>
  saveLogins?(): Promise<string[]>
  // Present when the computer can read apps' accessibility trees
  apps?: AppControl
  // Present when the bot's browser can be used through the DOM
  browser?: BrowserControl
}
