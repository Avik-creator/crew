import type { AppAction, AppControl } from "@crew/computer"
import { LIMITS } from "@crew/shared"
import { truncate } from "@crew/shared/node"
import { tool, type Tool } from "ai"
import { z } from "zod"

const REF_ACTIONS = ["click", "right-click", "focus", "clear", "check", "uncheck", "toggle", "expand", "collapse", "scroll-to"] as const

// Snapshots can be large; the model gets compact JSON cut to the usual limit
const compact = (value: unknown) => truncate(typeof value === "string" ? value : JSON.stringify(value), LIMITS.maxToolTextLength)

// Tools for apps on a computer that exposes their accessibility trees. The
// model reads an app, gets a ref for every control, and acts on refs.
export function appTools(apps: AppControl): Record<string, Tool> {
  return {
    listApps: tool({
      description: "List the apps running on the Mac, to find the exact name readApp needs.",
      inputSchema: z.object({}),
      execute: async () => compact(await apps.listApps()),
    }),
    readApp: tool({
      description:
        "Read an app's window as a tree of controls. Every control you can act on has a ref like @s8f3k2p9:e12. " +
        "Refs only last until the UI changes, so read again after acting. For a big app, set skeleton first, then read one part with root. " +
        "After an action opens a menu, sheet or alert, read it with surface.",
      inputSchema: z.object({
        app: z.string().describe("The app's name, e.g. Notes or Safari"),
        root: z.string().optional().describe("A ref from an earlier read, to read just that part"),
        skeleton: z.boolean().optional().describe("A shallow map of a big app"),
        surface: z.enum(["menu", "sheet", "alert"]).optional(),
      }),
      execute: async (input) => compact(await apps.snapshot(input)),
    }),
    useApp: tool({
      description:
        "Act on a control from the latest readApp: click, type or set-value (with text), select (with option), scroll (with direction), " +
        "check/uncheck/toggle, expand/collapse, focus, clear, scroll-to, right-click. press sends a key combo like cmd+s to an app. " +
        "If it says the ref is stale, read the app again and use the new ref. Don't repeat an action that may have landed; read first.",
      inputSchema: z.object({
        action: z.enum([...REF_ACTIONS, "type", "set-value", "select", "scroll", "press"]),
        ref: z.string().optional().describe("The control's ref; every action except press needs one"),
        text: z.string().optional().describe("For type and set-value"),
        option: z.string().optional().describe("For select: the option's visible text"),
        direction: z.enum(["up", "down", "left", "right"]).optional().describe("For scroll"),
        amount: z.number().int().min(1).max(20).optional().describe("For scroll"),
        keys: z.string().optional().describe("For press, e.g. cmd+s or return"),
        app: z.string().optional().describe("For press: which app gets the keys"),
      }),
      execute: async (input) => compact(await apps.act(toAction(input))),
    }),
  }
}

type UseAppInput = {
  action: (typeof REF_ACTIONS)[number] | "type" | "set-value" | "select" | "scroll" | "press"
  ref?: string
  text?: string
  option?: string
  direction?: "up" | "down" | "left" | "right"
  amount?: number
  keys?: string
  app?: string
}

// The flat tool input becomes a checked action, with a plain error when a
// field is missing so the model can correct itself
function toAction(i: UseAppInput): AppAction {
  if (i.action === "press") {
    if (!i.keys) throw new Error("press needs keys, e.g. cmd+s")
    return { type: "press", keys: i.keys, app: i.app }
  }
  if (!i.ref) throw new Error(`${i.action} needs a ref from readApp`)
  switch (i.action) {
    case "type":
    case "set-value":
      if (i.text === undefined) throw new Error(`${i.action} needs text`)
      return { type: i.action, ref: i.ref, text: i.text }
    case "select":
      if (!i.option) throw new Error("select needs the option's text")
      return { type: "select", ref: i.ref, option: i.option }
    case "scroll":
      return { type: "scroll", ref: i.ref, direction: i.direction ?? "down", amount: i.amount }
    default:
      return { type: i.action, ref: i.ref }
  }
}
