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

// Reads and operates apps through the OS accessibility tree: elements come
// back with refs, so actions don't depend on pixel positions
export interface AppControl {
  listApps(): Promise<unknown>
  snapshot(opts: AppSnapshotOptions): Promise<unknown>
  act(action: AppAction): Promise<unknown>
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
  // Runs the action and returns a screenshot of the result
  act(action: DesktopAction): Promise<ScreenshotPayload>
  openUrl(url: string): Promise<string>
  openApp?(name: string): Promise<string>
  saveLogins?(): Promise<string[]>
  // Present when the computer can read apps' accessibility trees
  apps?: AppControl
}
