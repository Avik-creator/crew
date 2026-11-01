import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

type DeviceStatus = { linked: boolean; online: boolean; name?: string; deviceId?: string; error?: string }

const listen = <T>(channel: string, cb: (value: T) => void) => {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => void ipcRenderer.removeListener(channel, handler)
}

// The renderer's only door to the system. No Node, no raw IPC.
const api = {
  config: () =>
    ipcRenderer.invoke("crew:config") as Promise<{ serverUrl: string; defaultServerUrl: string; platform: string; version: string }>,
  setServerUrl: (url: string | null) => ipcRenderer.invoke("crew:set-server-url", url) as Promise<void>,
  session: {
    get: () => ipcRenderer.invoke("crew:session:get") as Promise<string | null>,
    set: (token: string | null) => ipcRenderer.invoke("crew:session:set", token) as Promise<void>,
  },
  openExternal: (url: string) => ipcRenderer.invoke("crew:open-external", url) as Promise<void>,
  notify: (n: { title: string; body: string; path?: string }) => ipcRenderer.invoke("crew:notify", n) as Promise<void>,
  setBadge: (count: number) => ipcRenderer.invoke("crew:badge", count) as Promise<void>,
  device: {
    status: () =>
      ipcRenderer.invoke("crew:device:status") as Promise<
        DeviceStatus & {
          allowedPaths: string[]
          capabilities: { shell: boolean; files: boolean; screen: boolean; input: boolean; stdioMcp: boolean; apps: boolean }
        }
      >,
    link: (name: string) => ipcRenderer.invoke("crew:device:link", name) as Promise<{ id: string; name: string }>,
    unlink: () => ipcRenderer.invoke("crew:device:unlink") as Promise<void>,
    pickFolder: () => ipcRenderer.invoke("crew:device:pick-folder") as Promise<string | null>,
    setAllowedPaths: (paths: string[]) => ipcRenderer.invoke("crew:device:set-paths", paths) as Promise<void>,
    setMcpEnv: (serverId: string, env: Record<string, string>) =>
      ipcRenderer.invoke("crew:device:set-mcp-env", serverId, env) as Promise<void>,
    mcpEnvKeys: (serverId: string) => ipcRenderer.invoke("crew:device:mcp-env-keys", serverId) as Promise<string[]>,
    openPrivacy: (pane: "screen" | "accessibility") => ipcRenderer.invoke("crew:device:open-privacy", pane) as Promise<void>,
    onStatus: (cb: (s: DeviceStatus) => void) => listen("crew:device", cb),
  },
  update: {
    check: () => ipcRenderer.invoke("crew:update:check") as Promise<void>,
    install: () => ipcRenderer.invoke("crew:update:install") as Promise<void>,
    onState: (cb: (s: { state: string; version?: string; percent?: number; message?: string }) => void) =>
      listen("crew:update", cb),
  },
  onDeepLink: (cb: (url: string) => void) => listen("crew:deep-link", cb),
  onNavigate: (cb: (path: string) => void) => listen("crew:navigate", cb),
}

contextBridge.exposeInMainWorld("crew", api)

export type CrewBridge = typeof api
