import { BrowserWindow, screen } from "electron"

// A click-through frame around the screen while a bot drives the Mac, so the
// person always knows, with the kill switch spelled out
let win: BrowserWindow | null = null
let hideTimer: NodeJS.Timeout | undefined

const page = (botName: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 12px -apple-system,system-ui,sans-serif}
.frame{position:fixed;inset:0;border:2px solid rgba(10,132,255,.9);border-radius:10px}
.pill{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(28,28,30,.92);color:#f5f5f7;padding:6px 12px;border-radius:999px;display:flex;gap:8px;align-items:center}
.dot{width:7px;height:7px;border-radius:50%;background:#0a84ff}
kbd{font:inherit;background:#3a3a3c;padding:1px 6px;border-radius:5px}
</style></head><body><div class="frame"></div><div class="pill"><span class="dot"></span>${botName.replace(/[<>&]/g, "")} is using your Mac · <kbd>⌘⇧Esc</kbd> to stop</div></body></html>`

export function showOverlay(botName: string) {
  clearTimeout(hideTimer)
  if (!win || win.isDestroyed()) {
    const { bounds } = screen.getPrimaryDisplay()
    win = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      focusable: false,
      hasShadow: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      show: false,
      webPreferences: { sandbox: true },
    })
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, "screen-saver")
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setContentProtection(true) // keep the frame out of the bot's own screenshots
  }
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page(botName))}`)
  win.showInactive()
  // Fades away when the bot goes quiet
  hideTimer = setTimeout(hideOverlay, 8_000)
}

export function hideOverlay() {
  clearTimeout(hideTimer)
  if (win && !win.isDestroyed()) win.hide()
}
