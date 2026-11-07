import { createHash } from "node:crypto"

import { app, dialog, ipcMain, Notification, shell, systemPreferences, type BrowserWindow } from "electron"
// CommonJS package: its functions come off the default export in ESM
import nodeMachineId from "node-machine-id"

import type { DeviceAgent } from "./device/agent"
import { DEFAULT_SERVER_URL, secureStore, serverUrl } from "./store"

type Deps = { getWindow: () => BrowserWindow | null; agent: DeviceAgent; updater: { check(): void; install(): void } }

// This computer's hardware id, hashed with a Crew prefix so it can't be matched
// with what other apps send. Lets the server find a Mac's old record after a
// reinstall wiped what the app remembered.
function machineId() {
  try {
    return createHash("sha256").update(`crew:${nodeMachineId.machineIdSync(true)}`).digest("hex")
  } catch {
    return undefined
  }
}

const PRIVACY_PANES = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
}

// Everything the renderer may ask the main process for. Channel names match
// the preload bridge one to one.
export function registerIpc({ getWindow, agent, updater }: Deps) {
  const store = secureStore()

  ipcMain.handle("crew:config", () => ({
    serverUrl: serverUrl(),
    defaultServerUrl: DEFAULT_SERVER_URL,
    platform: process.platform,
    version: app.getVersion(),
  }))
  ipcMain.handle("crew:set-server-url", (_e, url: string | null) => {
    store.set("serverUrl", url ? url.replace(/\/$/, "") : undefined)
    agent.restart()
  })
  ipcMain.handle("crew:session:get", () => store.get("sessionToken") ?? null)
  ipcMain.handle("crew:session:set", (_e, token: string | null) => {
    store.set("sessionToken", token ?? undefined)
    if (!token) {
      // Signing out also unlinks this Mac
      store.set("device", undefined)
      agent.stop()
    }
  })
  ipcMain.handle("crew:open-external", (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle("crew:notify", (_e, n: { title: string; body: string; path?: string }) => {
    if (getWindow()?.isFocused()) return
    const note = new Notification({ title: n.title, body: n.body, silent: false })
    note.on("click", () => {
      const win = getWindow()
      win?.show()
      win?.focus()
      if (n.path) win?.webContents.send("crew:navigate", n.path)
    })
    note.show()
  })
  ipcMain.handle("crew:badge", (_e, count: number) => app.setBadgeCount(count))

  ipcMain.handle("crew:device:install-apps", async () => {
    await agent.refreshApps(true)
    return { ...agent.status, allowedPaths: store.get("allowedPaths") ?? [], capabilities: agent.capabilities() }
  })
  ipcMain.handle("crew:device:status", async () => {
    await agent.refreshApps()
    return { ...agent.status, allowedPaths: store.get("allowedPaths") ?? [], capabilities: agent.capabilities() }
  })
  // Links this Mac to the signed-in account: the server returns a device token
  // once. A Mac linked before gets its old record back with a new token.
  ipcMain.handle("crew:device:link", async (_e, name: string) => {
    const token = store.get("sessionToken")
    if (!token) throw new Error("Sign in first")
    const previous = store.get("device")?.id ?? store.get("unlinkedDeviceId")
    const res = await fetch(`${serverUrl()}/devices`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name, platform: process.platform, machineId: machineId(), ...(previous ? { deviceId: previous } : {}) }),
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't link this Mac")
    const { device, token: deviceToken } = (await res.json()) as { device: { id: string; name: string }; token: string }
    store.set("device", { id: device.id, name: device.name, token: deviceToken })
    store.set("unlinkedDeviceId", undefined)
    agent.restart()
    return device
  })
  ipcMain.handle("crew:device:unlink", () => {
    const device = store.get("device")
    if (device) store.set("unlinkedDeviceId", device.id)
    store.set("device", undefined)
    agent.stop()
    agent.start()
  })
  ipcMain.handle("crew:device:pick-folder", async () => {
    const win = getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle("crew:device:set-paths", (_e, paths: string[]) => {
    store.set("allowedPaths", paths)
    agent.refreshHello()
  })
  ipcMain.handle("crew:device:set-mcp-env", (_e, serverId: string, env: Record<string, string>) => {
    store.set("mcpEnv", { ...store.get("mcpEnv"), [serverId]: env })
  })
  ipcMain.handle("crew:device:mcp-env-keys", (_e, serverId: string) => Object.keys(store.get("mcpEnv")?.[serverId] ?? {}))
  ipcMain.handle("crew:device:open-privacy", (_e, pane: keyof typeof PRIVACY_PANES) => {
    if (pane === "accessibility") systemPreferences.isTrustedAccessibilityClient(true)
    return shell.openExternal(PRIVACY_PANES[pane])
  })
  ipcMain.handle("crew:update:check", () => updater.check())
  ipcMain.handle("crew:update:install", () => updater.install())
}
