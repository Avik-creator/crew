// Files and toolchains the computer needs. Our E2B template bakes them in;
// on a stock desktop image they're installed on first use, so either works.

export const SCRIPTS_VERSION = "8"
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
// loads every saved login into it. "save" exports the current logins.
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

if __name__ == "__main__":
    action, n = sys.argv[1], int(sys.argv[2])
    url = sys.argv[3] if len(sys.argv) > 3 else ""
    {"launch": lambda: launch(n, url), "save": lambda: save(n), "load": lambda: load(n)}[action]()
`
