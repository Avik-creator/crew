// Reads and operates the apps on one bot's display through the accessibility
// tree (AT-SPI), the way screen readers do. "read" lists an app's controls with
// a ref each and where they are; "act" works a control by ref. Refs are checked
// against the read they came from, so a changed UI gives a clear error instead
// of a wrong click. Uses the system's own bindings: agent-desktop crashes apps
// on this image's older accessibility libraries.
export const appsScript = String.raw`#!/usr/bin/env python3
import json, os, random, string, subprocess, sys, warnings
warnings.filterwarnings("ignore")
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

STORE = os.path.expanduser("~/.crew/apps")
MAX_REFS = 300
MAX_NODES = 3000
S = Atspi.StateType
# Processes that are part of the desktop rather than apps a bot works in
BACKGROUND = {"xfce4-panel", "xfwm4", "xfce4-notifyd", "wrapper-2.0", "xdg-desktop-portal-gtk", "xfdesktop", "xfsettingsd", "at-spi2-registryd"}
TEXTY = {"text", "entry", "password text", "terminal", "spin button", "editbar", "paragraph", "document text"}
# Layout that only adds depth; their children still show
SKIP = {"filler", "panel", "scroll pane", "viewport", "layered pane", "split pane", "unknown", "redundant object", "section", "grouping"}
NEVER_REF = {"frame", "window", "dialog", "alert", "menu bar", "tool bar", "status bar", "separator", "scroll bar", "page tab list", "tree table", "table", "list", "tree", "label", "heading", "static", "icon"}
CONTEXT = {"frame", "window", "dialog", "alert", "label", "heading", "static", "status bar", "page tab list", "tool bar", "menu bar", "list", "table", "tree table", "tree"}

class Fail(Exception): pass

def safe(f, default=None):
    try: return f()
    except Exception: return default

def ifaces(o): return set(safe(lambda: o.get_interfaces(), []) or [])

def actions(o):
    if "Action" not in ifaces(o): return []
    return [safe(lambda i=i: o.get_action_name(i), "") for i in range(safe(o.get_n_actions, 0) or 0)]

def do_named(o, names):
    for i, a in enumerate(actions(o)):
        if a in names: return bool(safe(lambda: o.do_action(i), False))
    return False

def box(o):
    e = safe(lambda: o.get_extents(Atspi.CoordType.SCREEN))
    return (e.x, e.y, e.width, e.height) if e and e.width > 0 and e.height > 0 else None

def center(o):
    b = box(o)
    if not b: raise Fail("That control isn't on the screen. Scroll to it or read the app again.")
    return b[0] + b[2] // 2, b[1] + b[3] // 2

def text_of(o, head, tail=0):
    if "Text" not in ifaces(o): return None
    n = safe(o.get_character_count, 0) or 0
    if tail and n > tail: return "…" + (safe(lambda: o.get_text(n - tail, n), "") or "")
    return safe(lambda: o.get_text(0, min(n, head)), "") or ""

def xdo(*args): subprocess.run(["xdotool", *[str(a) for a in args]], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def desktop_apps():
    d = Atspi.get_desktop(0)
    return [a for a in (safe(lambda i=i: d.get_child_at_index(i)) for i in range(d.get_child_count())) if a]

def windows(app):
    out = []
    for i in range(safe(app.get_child_count, 0) or 0):
        w = safe(lambda: app.get_child_at_index(i))
        if w and safe(lambda: w.get_state_set().contains(S.SHOWING), False): out.append((i, w))
    return out

def find_app(name):
    apps = [a for a in desktop_apps() if (safe(a.get_name, "") or "") not in BACKGROUND]
    want = name.strip().lower()
    hits = [a for a in apps if (safe(a.get_name, "") or "").lower() == want]
    showing = [a for a in hits if windows(a)]
    if showing or hits: return (showing or hits)[-1]
    names = sorted({safe(a.get_name, "") for a in apps if windows(a)} - {""})
    raise Fail(f"No app named '{name}' is open. Open apps: {', '.join(names) or 'none'}. Start it first, or use one of these names.")

def list_apps():
    out = []
    for a in desktop_apps():
        name = safe(a.get_name, "") or ""
        ws = windows(a)
        if name in BACKGROUND or not ws: continue
        out.append({"name": name, "pid": safe(a.get_process_id, 0), "windows": [safe(w.get_name, "") or "" for _, w in ws]})
    return {"apps": out}

def store_dir(n):
    d = os.path.join(STORE, str(n))
    os.makedirs(d, exist_ok=True)
    return d

def read(n, opts):
    app_name = opts.get("app") or ""
    root_ref = opts.get("root")
    skeleton = bool(opts.get("skeleton")) and not root_ref
    if root_ref:
        app, start, start_path, _ = resolve(n, root_ref)
        starts = [(start_path, start)]
    else:
        app = find_app(app_name)
        starts = [([i], w) for i, w in windows(app)]
        if not starts: raise Fail(f"{safe(app.get_name, app_name)} is running but shows no window.")
    sid = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    refs, lines = {}, []
    state = {"nodes": 0, "truncated": False}

    def walk(o, path, depth, indent):
        state["nodes"] += 1
        if state["nodes"] > MAX_NODES or len(refs) >= MAX_REFS:
            state["truncated"] = True
            return
        st = safe(o.get_state_set)
        if depth > 0 and not (st and st.contains(S.SHOWING)): return
        role = safe(o.get_role_name, "") or ""
        name = " ".join((safe(o.get_name, "") or "").split())[:80]
        acts = actions(o)
        texty = role in TEXTY
        flags = []
        if st:
            for s, label in ((S.FOCUSED, "focused"), (S.CHECKED, "checked"), (S.SELECTED, "selected"), (S.EXPANDED, "expanded")):
                if st.contains(s): flags.append(label)
            if not st.contains(S.SENSITIVE) and not st.contains(S.ENABLED): flags.append("disabled")
            if texty and not st.contains(S.EDITABLE) and role != "terminal": flags.append("read-only")
        interactive = role not in NEVER_REF and role not in SKIP and (
            bool([a for a in acts if a]) or texty or (st and (st.contains(S.FOCUSABLE) or st.contains(S.SELECTABLE)))
        )
        b = box(o)
        kids = safe(o.get_child_count, 0) or 0
        if interactive and not name and not texty and (kids or not b):
            interactive = False  # an unnamed row or wrapper: its children carry the names
        if interactive and role in ("table cell", "list item", "tree item") and not (b and name):
            interactive = False  # an icon or expander column, or a cell that isn't drawn
        shown = False
        if interactive:
            ref = f"e{len(refs) + 1}"
            refs[ref] = {"path": path, "role": role, "name": name}
            line = f"[@{sid}:{ref}] {role}" + (f' "{name}"' if name else "") + (f" ({', '.join(flags)})" if flags else "")
            if b: line += f" at {b[0] + b[2] // 2},{b[1] + b[3] // 2}"
            if texty:
                value = text_of(o, 300, 1500 if role == "terminal" else 0)
                if value and value.strip():
                    if "\n" in value.strip(): line += "\n" + "\n".join("  " * (indent + 1) + "| " + l for l in value.rstrip().split("\n")[-40:])
                    else: line += f' = "{value.strip()[:300]}"'
            lines.append("  " * indent + line)
            shown = True
        elif name and role in CONTEXT:
            lines.append("  " * indent + f'{role} "{name}"' + (f" ({', '.join(flags)})" if flags else ""))
            shown = True
        if texty and interactive: return
        if skeleton and indent >= 3:
            count = safe(o.get_child_count, 0) or 0
            if count and shown: lines[-1] += f" [{count} inside: read with root]"
            return
        for i in range(safe(o.get_child_count, 0) or 0):
            c = safe(lambda: o.get_child_at_index(i))
            if c: walk(c, path + [i], depth + 1, indent + (1 if shown else 0))

    for path, o in starts: walk(o, path, 0, 0)
    d = store_dir(n)
    with open(os.path.join(d, sid + ".json"), "w") as f:
        json.dump({"app": safe(app.get_name, ""), "pid": safe(app.get_process_id, 0), "refs": refs}, f)
    for old in sorted(os.listdir(d), key=lambda x: os.path.getmtime(os.path.join(d, x)))[:-20]:
        safe(lambda: os.remove(os.path.join(d, old)))
    head = f"{safe(app.get_name, '')}: {len(refs)} controls" + (" (cut short; read one part with root)" if state["truncated"] else "")
    return head + "\n" + "\n".join(lines)

def resolve(n, ref):
    try:
        sid, eid = ref.lstrip("@").split(":", 1)
        with open(os.path.join(store_dir(n), sid + ".json")) as f: snap = json.load(f)
        entry = snap["refs"][eid]
    except Exception:
        raise Fail(f"{ref} isn't from a recent read. Read the app again and use a ref from that read.")
    app = next((a for a in desktop_apps() if safe(a.get_process_id) == snap["pid"]), None)
    if not app: raise Fail(f"{snap['app']} has closed since that read.")
    o = app
    for i in entry["path"]:
        o = safe(lambda: o.get_child_at_index(i))
        if not o: break
    if not o or safe(o.get_role_name) != entry["role"] or (entry["name"] and entry["role"] not in TEXTY and " ".join((safe(o.get_name, "") or "").split())[:80] != entry["name"]):
        raise Fail(f"{ref} changed since that read. Read the app again and use the new ref.")
    return app, o, entry["path"], entry

# Raises and focuses the app's window that holds the control. Focus is set
# directly: this window manager doesn't take activation requests.
def activate(app, path=None):
    pid = safe(app.get_process_id, 0)
    ids = subprocess.run(["xdotool", "search", "--onlyvisible", "--pid", str(pid)], capture_output=True, text=True).stdout.split()
    if not ids: return
    title = safe(lambda: app.get_child_at_index(path[0]).get_name()) if path else None
    pick = ids[-1]
    for w in ids:
        if title and subprocess.run(["xdotool", "getwindowname", w], capture_output=True, text=True).stdout.strip() == title: pick = w
    subprocess.run(["xdotool", "windowraise", pick, "windowfocus", "--sync", pick], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def act(n, a):
    t = a.get("type")
    if t == "press":
        if a.get("ref"):
            app, o, path, _ = resolve(n, a["ref"])
            activate(app, path)
            safe(o.grab_focus)
        elif a.get("app"): activate(find_app(a["app"]))
        xdo("key", "--", *a["keys"].split())
        return f"Pressed {a['keys']}"
    app, o, path, entry = resolve(n, a.get("ref", ""))
    what = f"{entry['role']}" + (f" \"{entry['name']}\"" if entry["name"] else "")
    st = safe(o.get_state_set)
    has = lambda s: bool(st and st.contains(s))
    if t == "click":
        if not do_named(o, {"click", "press", "activate", "jump", "open", "toggle", "select"}):
            x, y = center(o); xdo("mousemove", x, y, "click", 1)
    elif t == "right-click":
        if not do_named(o, {"menu", "popup", "show menu", "showmenu"}):
            x, y = center(o); xdo("mousemove", x, y, "click", 3)
    elif t == "focus":
        activate(app, path)
        if not safe(o.grab_focus, False):
            x, y = center(o); xdo("mousemove", x, y, "click", 1)
    elif t == "type":
        activate(app, path)
        if not safe(o.grab_focus, False):
            x, y = center(o); xdo("mousemove", x, y, "click", 1)
        xdo("type", "--delay", 12, "--", a["text"])
    elif t in ("set-value", "clear"):
        value = a.get("text", "") if t == "set-value" else ""
        if not ("EditableText" in ifaces(o) and safe(lambda: o.set_text_contents(value), False)):
            activate(app, path)
            if not safe(o.grab_focus, False):
                x, y = center(o); xdo("mousemove", x, y, "click", 1)
            xdo("key", "ctrl+a", "BackSpace")
            if value: xdo("type", "--delay", 12, "--", value)
    elif t in ("check", "uncheck", "toggle"):
        if t == "toggle" or has(S.CHECKED) != (t == "check"):
            if not do_named(o, {"click", "toggle", "press", "activate"}):
                x, y = center(o); xdo("mousemove", x, y, "click", 1)
    elif t in ("expand", "collapse"):
        if has(S.EXPANDED) != (t == "expand"):
            if not do_named(o, {"expand or contract", "expand or collapse", "activate", "click", "press"}):
                x, y = center(o); xdo("mousemove", x, y, "click", 1)
    elif t == "select":
        want = a["option"].strip().lower()
        def search(node, depth):
            if depth > 6: return None
            for i in range(safe(node.get_child_count, 0) or 0):
                c = safe(lambda: node.get_child_at_index(i))
                if not c: continue
                if (safe(c.get_name, "") or "").strip().lower() == want: return node, i, c
                found = search(c, depth + 1)
                if found: return found
            return None
        found = search(o, 0)
        if not found: raise Fail(f"{what} has no option \"{a['option']}\".")
        parent, i, c = found
        if not ("Selection" in ifaces(parent) and safe(lambda: parent.select_child(i), False)):
            if not do_named(c, {"click", "press", "activate", "select"}): raise Fail(f"Couldn't pick \"{a['option']}\".")
    elif t == "scroll":
        x, y = center(o)
        button = {"up": 4, "down": 5, "left": 6, "right": 7}[a.get("direction", "down")]
        xdo("mousemove", x, y, "click", "--repeat", max(1, min(int(a.get("amount") or 3), 20)), button)
    elif t == "scroll-to":
        if not safe(lambda: o.scroll_to(Atspi.ScrollType.ANYWHERE), False): raise Fail(f"Couldn't scroll to {what}.")
    else:
        raise Fail(f"Unknown action {t}")
    done = {"click": "Clicked", "right-click": "Right-clicked", "focus": "Focused", "type": "Typed into", "set-value": "Set",
            "clear": "Cleared", "check": "Checked", "uncheck": "Unchecked", "toggle": "Toggled", "expand": "Expanded",
            "collapse": "Collapsed", "select": f"Picked \"{a.get('option')}\" in", "scroll": "Scrolled", "scroll-to": "Scrolled to"}[t]
    return f"{done} {what}. Read the app again to see the result."

if __name__ == "__main__":
    command, n = sys.argv[1], int(sys.argv[2])
    arg = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    try:
        out = {"list": lambda: list_apps(), "read": lambda: read(n, arg), "act": lambda: act(n, arg)}[command]()
        print(json.dumps(out))
    except Fail as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}", file=sys.stderr)
        sys.exit(1)
`
