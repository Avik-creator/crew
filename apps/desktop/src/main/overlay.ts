import { BrowserWindow, screen } from "electron"

// A click-through frame around the screen while a bot drives the Mac, so the
// person always knows, with the kill switch spelled out
let win: BrowserWindow | null = null
let hideTimer: NodeJS.Timeout | undefined

const page = (botName: string) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:600 12px -apple-system,system-ui,sans-serif}
.frame{position:fixed;inset:0;border:3px solid rgba(139,92,246,.9);border-radius:10px;box-shadow:inset 0 0 24px rgba(139,92,246,.35)}
.pill{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(17,17,23,.92);color:#ececf1;padding:6px 12px;border-radius:999px;display:flex;gap:8px;align-items:center;border:1px solid rgba(139,92,246,.6)}
.dot{width:7px;height:7px;border-radius:50%;background:#a78bfa;animation:p 1.2s infinite}
kbd{font:inherit;background:#2a2a35;padding:1px 6px;border-radius:5px}
@keyframes p{50%{opacity:.3}}
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
