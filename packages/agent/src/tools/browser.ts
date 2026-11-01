import type { BrowserControl, PageAction } from "@crew/computer"
import { LIMITS } from "@crew/shared"
import { truncate } from "@crew/shared/node"
import { tool, type Tool } from "ai"
import { z } from "zod"

const compact = (value: unknown) => truncate(JSON.stringify(value), LIMITS.maxToolTextLength)

// The web page lane: the bot reads and uses the page in its browser through
// the DOM. Exact text and URLs come from the page itself, so nothing is lost to
// a cropped or blurry screenshot.
export function browserTools(browser: BrowserControl): Record<string, Tool> {
  return {
    readPage: tool({
      description:
        "Read the page open in your browser: its URL, title, visible text and every link with its exact URL. " +
        "Use this to get facts and links from a page instead of reading a screenshot.",
      inputSchema: z.object({
        maxChars: z.number().int().min(1000).max(60_000).optional().describe("How much of the page text to return (default 20000)"),
      }),
      execute: async ({ maxChars }) => compact(await browser.read(maxChars)),
    }),
    pageControls: tool({
      description:
        "List the buttons, links, fields and menus on the open page, each with a ref like e12 for usePage. " +
        "Refs last until the page changes; call this again after navigating.",
      inputSchema: z.object({}),
      execute: async () => compact(await browser.controls()),
    }),
    usePage: tool({
      description:
        "Act on the open page: click a ref, fill a field (set submit to press Enter after), select an option, press a key " +
        "(e.g. Enter, Control+L), go to a URL, go back, or scroll. Returns the page's URL and title afterwards.",
      inputSchema: z.object({
        action: z.enum(["click", "fill", "select", "press", "goto", "back", "scroll"]),
        ref: z.string().optional().describe("From pageControls; needed for click, fill and select"),
        text: z.string().optional().describe("For fill"),
        submit: z.boolean().optional().describe("For fill: press Enter after typing"),
        option: z.string().optional().describe("For select: the option's visible text"),
        key: z.string().optional().describe("For press"),
        url: z.string().optional().describe("For goto"),
        direction: z.enum(["up", "down"]).optional().describe("For scroll"),
      }),
      execute: async (input) => compact(await browser.act(toAction(input))),
    }),
  }
}

type UsePageInput = {
  action: PageAction["type"]
  ref?: string
  text?: string
  submit?: boolean
  option?: string
  key?: string
  url?: string
  direction?: "up" | "down"
}

// Checks the flat tool input, with a plain error the model can fix
function toAction(i: UsePageInput): PageAction {
  const need = (field: string | undefined, what: string) => {
    if (!field) throw new Error(`${i.action} needs ${what}`)
    return field
  }
  switch (i.action) {
    case "click":
      return { type: "click", ref: need(i.ref, "a ref from pageControls") }
    case "fill":
      return { type: "fill", ref: need(i.ref, "a ref from pageControls"), text: i.text ?? "", submit: i.submit }
    case "select":
      return { type: "select", ref: need(i.ref, "a ref from pageControls"), option: need(i.option, "the option's text") }
    case "press":
      return { type: "press", key: need(i.key, "a key, e.g. Enter") }
    case "goto":
      return { type: "goto", url: need(i.url, "a url") }
    case "back":
      return { type: "back" }
    case "scroll":
      return { type: "scroll", direction: i.direction ?? "down" }
  }
}
