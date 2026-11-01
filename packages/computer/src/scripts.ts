// Files and toolchains the computer needs. Our E2B template bakes them in;
// on a stock desktop image they're installed on first use, so either works.

export const SCRIPTS_VERSION = "9"
export const HOME = "/home/user"
export const CREW_DIR = `${HOME}/.crew`
export const WORKSPACE = `${HOME}/workspace`

// Idempotent installers, keyed by what needs them
export const TOOLCHAINS = {
  node: `command -v node >/dev/null && node -v | grep -qE '^v(2[0-9])' || (curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs)`,
  uv: `command -v uvx >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh && sudo ln -sf ${HOME}/.local/bin/uv /usr/local/bin/uv && sudo ln -sf ${HOME}/.local/bin/uvx /usr/local/bin/uvx)`,
  playwright: `python3 -c "import playwright" 2>/dev/null || python3 -m pip install --user -q playwright==1.58.0`,
} as const
export type Toolchain = keyof typeof TOOLCHAINS

// Opens Chrome on a bot's display with its own profile and a debugging port, and
// loads every saved login into it. "save" exports the current logins. "read",
// "controls" and "act" let a bot use the open page through the DOM: exact text
// and link URLs, and controls it can click or fill by ref, instead of pixels.
export const browserScript = String.raw`#!/usr/bin/env python3
import json, os, subprocess, sys, time, glob, urllib.request

HOME = os.path.expanduser("~")
SESSIONS = os.path.join(HOME, "workspace", ".sessions")

def cdp_port(n): return 9300 + n

def running(n):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{cdp_port(n)}/json/version", timeout=1)
        return True
    except Exception:
        return False

def launch(n, url):
    if not running(n):
        profile = os.path.join(HOME, ".profiles", f"bot-{n}")
        os.makedirs(profile, exist_ok=True)
        chrome = next((c for c in ["google-chrome", "chromium", "chromium-browser"] if subprocess.call(["which", c], stdout=subprocess.DEVNULL) == 0), "google-chrome")
        subprocess.Popen([chrome, f"--user-data-dir={profile}", f"--remote-debugging-port={cdp_port(n)}",
                          "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage",
                          "--start-maximized", url or "about:blank"],
                         env={**os.environ, "DISPLAY": f":{n}"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        for _ in range(50):
            if running(n): break
            time.sleep(0.2)
        load(n)
    elif url:
        with_browser(n, lambda ctx: (lambda pg: (pg.goto(url, wait_until="commit"), pg.bring_to_front()))(ctx.new_page()))
    print("ok")

def with_browser(n, fn):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(f"http://127.0.0.1:{cdp_port(n)}")
        ctx = b.contexts[0] if b.contexts else b.new_context()
        return fn(ctx)

def load(n):
    files = glob.glob(os.path.join(SESSIONS, "*.json"))
    if not files: return
    def go(ctx):
        cookies = []
        for f in files:
            try: cookies += json.load(open(f)).get("cookies", [])
            except Exception: pass
        if cookies: ctx.add_cookies(cookies)
    try: with_browser(n, go)
    except Exception as e: print("load failed:", e, file=sys.stderr)

def save(n):
    os.makedirs(SESSIONS, exist_ok=True)
    def go(ctx):
        state = ctx.storage_state()
        by_domain = {}
        for c in state.get("cookies", []):
            d = c["domain"].lstrip(".")
            parts = d.split(".")
            root = ".".join(parts[-2:]) if len(parts) >= 2 else d
            by_domain.setdefault(root, []).append(c)
        for d, cs in by_domain.items():
            json.dump({"cookies": cs}, open(os.path.join(SESSIONS, f"{d}.json"), "w"))
        return sorted(by_domain)
    domains = with_browser(n, go)
    print(json.dumps(domains))

VISIBLE_JS = """el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }"""

READ_JS = """(maxChars) => {
  const visible = %s
  const seen = new Set()
  const links = []
  for (const a of document.querySelectorAll('a[href]')) {
    if (!a.href.startsWith('http') || !visible(a)) continue
    const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\\s+/g, ' ').slice(0, 120)
    const key = text + '|' + a.href
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ text, href: a.href })
    if (links.length >= 300) break
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n')
  return { url: location.href, title: document.title, text: text.slice(0, maxChars), truncated: text.length > maxChars, links }
}""" % VISIBLE_JS

CONTROLS_JS = """() => {
  const visible = %s
  const sel = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [contenteditable=true], ' +
    '[role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [role=option], [role=combobox]'
  document.querySelectorAll('[data-crew-ref]').forEach(el => el.removeAttribute('data-crew-ref'))
  const controls = []
  for (const el of document.querySelectorAll(sel)) {
    if (!visible(el)) continue
    const ref = 'e' + (controls.length + 1)
    el.setAttribute('data-crew-ref', ref)
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'text') : tag)
    const name = (el.getAttribute('aria-label') || el.innerText || el.placeholder || el.title || el.name || '').trim().replace(/\\s+/g, ' ').slice(0, 100)
    const item = { ref, role, name }
    if (tag === 'a') item.href = el.href
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.value) item.value = String(el.value).slice(0, 100)
    if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked
    controls.push(item)
    if (controls.length >= 400) break
  }
  return { url: location.href, title: document.title, controls }
}""" % VISIBLE_JS

def active_page(ctx):
    pages = [p for p in ctx.pages if not p.url.startswith("devtools://")]
    if not pages:
        raise RuntimeError("No page is open. Open one with openUrl first.")
    for p in reversed(pages):
        try:
            if p.evaluate("document.visibilityState") == "visible": return p
        except Exception:
            pass
    return pages[-1]

def read(n, max_chars):
    if not running(n): raise RuntimeError("The browser isn't open. Open a page with openUrl first.")
    print(json.dumps(with_browser(n, lambda ctx: active_page(ctx).evaluate(READ_JS, max_chars))))

def controls(n):
    if not running(n): raise RuntimeError("The browser isn't open. Open a page with openUrl first.")
    print(json.dumps(with_browser(n, lambda ctx: active_page(ctx).evaluate(CONTROLS_JS))))

def act(n, spec):
    a = json.loads(spec)
    if not running(n): raise RuntimeError("The browser isn't open. Open a page with openUrl first.")
    def go(ctx):
        pg = active_page(ctx)
        t = a["type"]
        def target():
            loc = pg.locator('[data-crew-ref="%s"]' % a["ref"]).first
            if loc.count() == 0: raise RuntimeError("Ref %s is gone; the page changed. Call pageControls again." % a["ref"])
            return loc
        before = len(ctx.pages)
        if t == "goto": pg.goto(a["url"], wait_until="domcontentloaded", timeout=30000)
        elif t == "back": pg.go_back(wait_until="domcontentloaded", timeout=15000)
        elif t == "click": target().click(timeout=8000)
        elif t == "fill":
            el = target()
            el.fill(a.get("text", ""), timeout=8000)
            if a.get("submit"): el.press("Enter")
        elif t == "select": target().select_option(label=a["option"], timeout=8000)
        elif t == "press": pg.keyboard.press(a["key"])
        elif t == "scroll": pg.mouse.wheel(0, -700 if a.get("direction") == "up" else 700)
        else: raise RuntimeError("Unknown action " + t)
        try: pg.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception: pass
        time.sleep(0.4)
        now = active_page(ctx)
        if len(ctx.pages) > before: now.bring_to_front()
        return {"url": now.url, "title": now.title(), "newTab": len(ctx.pages) > before}
    print(json.dumps(with_browser(n, go)))

if __name__ == "__main__":
    action, n = sys.argv[1], int(sys.argv[2])
    arg = sys.argv[3] if len(sys.argv) > 3 else ""
    try:
        {"launch": lambda: launch(n, arg), "save": lambda: save(n), "load": lambda: load(n),
         "read": lambda: read(n, int(arg or "20000")), "controls": lambda: controls(n), "act": lambda: act(n, arg)}[action]()
    except Exception as e:
        print(str(e).splitlines()[0] if str(e) else type(e).__name__, file=sys.stderr)
        sys.exit(1)
`
