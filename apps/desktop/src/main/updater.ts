import { app, type BrowserWindow } from "electron"
import electronUpdater from "electron-updater"

export type UpdateState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string }

// Auto-update from GitHub Releases (electron-builder publish config)
export function setupUpdater(getWindow: () => BrowserWindow | null) {
  const { autoUpdater } = electronUpdater
  const emit = (s: UpdateState) => getWindow()?.webContents.send("crew:update", s)
  autoUpdater.autoDownload = true
  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }))
  autoUpdater.on("update-available", (i) => emit({ state: "available", version: i.version }))
  autoUpdater.on("update-not-available", () => emit({ state: "idle" }))
  autoUpdater.on("download-progress", (p) => emit({ state: "downloading", percent: Math.round(p.percent) }))
  autoUpdater.on("update-downloaded", (i) => emit({ state: "ready", version: i.version }))
  autoUpdater.on("error", (e) => emit({ state: "error", message: e.message }))
  const check = () => {
    if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {})
  }
  check()
  setInterval(check, 4 * 60 * 60_000)
  return { check, install: () => autoUpdater.quitAndInstall() }
}
