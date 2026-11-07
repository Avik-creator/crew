import type { AppAction, AppControl } from "@crew/computer"
import { LIMITS } from "@crew/shared"
import { truncate } from "@crew/shared/node"
import { tool, type Tool } from "ai"
import { z } from "zod"

const REF_ACTIONS = ["click", "right-click", "focus", "clear", "check", "uncheck", "toggle", "expand", "collapse", "scroll-to"] as const

// A ref from readApp, like @k3f9x:e12
const REF = /^@?\w+:e\d+$/

// Most a single useApp call may do before the model reads again
const MAX_ACTIONS = 8

// Snapshots can be large; the model gets compact JSON cut to the usual limit
const compact = (value: unknown) => truncate(typeof value === "string" ? value : JSON.stringify(value), LIMITS.maxToolTextLength)

const appAction = z.object({
  action: z.enum([...REF_ACTIONS, "type", "set-value", "select", "scroll", "press"]),
  ref: z.string().optional().describe("The control's ref; every action needs one except press, where it's optional"),
  text: z.string().optional().describe("For type and set-value"),
  option: z.string().optional().describe("For select: the option's visible text"),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("For scroll"),
  amount: z.number().int().min(1).max(20).optional().describe("For scroll"),
  keys: z.string().optional().describe("For press, e.g. ctrl+s or return"),
  app: z.string().optional().describe("For press: which app gets the keys"),
})

// Tools for apps on a computer that exposes their accessibility trees. The
// model reads an app, gets a ref for every control, and acts on refs.
export function appTools(apps: AppControl): Record<string, Tool> {
  return {
    listApps: tool({
      description: "List the apps open on the computer, with the exact names readApp needs.",
      inputSchema: z.object({}),
      execute: async () => compact(await apps.listApps()),
    }),
    readApp: tool({
      description:
        "Read an app's window as a list of controls. Every control you can act on has a ref like @k3f9x:e12. " +
        "Refs only last until the UI changes, so read again after acting. For a big app, set skeleton first, then read one part with root. " +
        "After an action opens a menu, sheet or alert, read it with surface.",
      inputSchema: z.object({
        app: z.string().describe("The app's name as listApps shows it, e.g. Notes, Safari or mousepad"),
        root: z.string().optional().describe("A ref from an earlier read, to read just that part"),
        skeleton: z.boolean().optional().describe("A shallow map of a big app"),
        surface: z.enum(["menu", "sheet", "alert"]).optional(),
      }),
      // Models fill unused fields with placeholders like "root"; only a real ref drills in
      execute: async ({ root, ...input }) => compact(await apps.snapshot({ ...input, ...(root && REF.test(root.trim()) ? { root: root.trim() } : {}) })),
    }),
    useApp: tool({
      description:
        "Act on controls from the latest readApp, in order: click, type or set-value (with text), select (with option), scroll (with direction), " +
        "check/uncheck/toggle, expand/collapse, focus, clear, scroll-to, right-click. " +
        "type sends text like a keyboard; end it with a newline to press Return, e.g. to run a command in a terminal. " +
        "press sends only keys, like ctrl+s or return, to the control in ref or to the app. " +
        `Up to ${MAX_ACTIONS} actions, e.g. filling a form and pressing its button; stop before a step that depends on what appears. ` +
        "Set readAfter to the app's name to get a fresh read with the result. If a ref is stale, read the app again and use the new ref. " +
        "Don't repeat an action that may have landed; read first.",
      inputSchema: z.object({
        actions: z.array(appAction).min(1).max(MAX_ACTIONS),
        readAfter: z.string().optional().describe("The app's name: read it again after the actions"),
      }),
      execute: async ({ actions, readAfter }) => {
        const lines: string[] = []
        let failed = false
        for (const [i, a] of actions.entries()) {
          try {
            const out = await apps.act(toAction(a))
            lines.push(`${i + 1}. ${typeof out === "string" ? out : truncate(JSON.stringify(out ?? "Done."), 300)}`)
          } catch (err) {
            lines.push(`${i + 1}. Failed: ${err instanceof Error ? err.message : String(err)}`)
            if (i < actions.length - 1) lines.push("The actions after it didn't run.")
            failed = true
            break
          }
        }
        if (readAfter) {
          // Give the UI a moment to settle before reading it back
          await new Promise((r) => setTimeout(r, failed ? 0 : 300))
          const read = await apps.snapshot({ app: readAfter }).catch((err: unknown) => `Couldn't read ${readAfter}: ${err instanceof Error ? err.message : String(err)}`)
          lines.push("", typeof read === "string" ? read : JSON.stringify(read))
        }
        return compact(lines.join("\n"))
      },
    }),
  }
}

type AppActionInput = z.infer<typeof appAction>

// The flat tool input becomes a checked action, with a plain error when a
// field is missing so the model can correct itself. Models fill unused fields
// with blanks, so an empty string counts as missing.
function toAction(i: AppActionInput): AppAction {
  const ref = i.ref?.trim()
  if (i.action === "press") {
    if (!i.keys?.trim()) throw new Error("press needs keys, e.g. ctrl+s")
    return { type: "press", keys: i.keys.trim(), app: i.app?.trim() || undefined, ...(ref && REF.test(ref) ? { ref } : {}) }
  }
  if (!ref) throw new Error(`${i.action} needs a ref from readApp`)
  switch (i.action) {
    case "type":
    case "set-value":
      if (i.text === undefined) throw new Error(`${i.action} needs text`)
      return { type: i.action, ref, text: i.text }
    case "select":
      if (!i.option?.trim()) throw new Error("select needs the option's text")
      return { type: "select", ref, option: i.option }
    case "scroll":
      return { type: "scroll", ref, direction: i.direction ?? "down", amount: i.amount }
    default:
      return { type: i.action, ref }
  }
}
