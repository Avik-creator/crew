import { join } from "node:path"

import { DEEP_LINK_SCHEME } from "@crew/shared"
import { app, BrowserWindow, globalShortcut, Menu, nativeImage, nativeTheme, shell, Tray } from "electron"

import { DeviceAgent } from "./device/agent"
import { registerIpc } from "./ipc"
import { setupUpdater } from "./updater"

let win: BrowserWindow | null = null
let tray: Tray | null = null
let pendingLink: string | null = null
const getWindow = () => win

if (!app.requestSingleInstanceLock()) app.quit()

// crew:// links (connector sign-in, notifications) arrive here
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [join(process.argv[1] ?? "")])
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
}

function handleLink(url: string) {
  if (!url.startsWith(`${DEEP_LINK_SCHEME}://`)) return
  if (!win) {
    pendingLink = url
    return
  }
  win.show()
  win.focus()
  win.webContents.send("crew:deep-link", url)
}

app.on("open-url", (event, url) => {
  event.preventDefault()
  handleLink(url)
})
app.on("second-instance", (_e, argv) => {
  const link = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`))
  if (link) handleLink(link)
  else win?.show()
})

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    // Solid, like the page under it, so the window never flashes another color
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.once("ready-to-show", () => {
    win?.show()
    if (pendingLink) {
      win?.webContents.send("crew:deep-link", pendingLink)
      pendingLink = null
    }
  })
  win.on("closed", () => (win = null))
  // Links open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

function createTray(agent: DeviceAgent) {
  const icon = nativeImage.createFromPath(join(import.meta.dirname, "../../resources/trayTemplate.png"))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  if (icon.isEmpty()) tray.setTitle("Crew")
  const render = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: agent.status.online ? "This Mac is available to bots" : "This Mac is offline", enabled: false },
        { label: "Stop bots on this Mac  ⌘⇧Esc", click: () => agent.kill() },
        { type: "separator" },
        { label: "Open Crew", click: () => (win ? win.show() : createWindow()) },
        { label: "Quit", role: "quit" },
      ]),
    )
  render()
  return render
}

app.whenReady().then(() => {
  app.setAppUserModelId("dev.crew.desktop")
  // A packaged build takes its icon from build/icon.icns; in dev, show it too
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, "../../resources/icon.png"))
  let renderTray = () => {}
  const agent = new DeviceAgent((status) => {
    win?.webContents.send("crew:device", status)
    renderTray()
  })
  const updater = setupUpdater(getWindow)
  registerIpc({ getWindow, agent, updater })
  createWindow()
  renderTray = createTray(agent)
  agent.start()

  // The kill switch works even when Crew isn't focused
  globalShortcut.register("CommandOrControl+Shift+Escape", () => agent.kill())

  app.on("activate", () => {
    if (!win) createWindow()
    else win.show()
  })
  app.on("will-quit", () => {
    globalShortcut.unregisterAll()
    agent.stop()
  })
})

// Stay in the tray so bots can keep using this Mac with the window closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
