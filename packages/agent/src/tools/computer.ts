import { createHash } from "node:crypto"

import type { ComputerDriver, DesktopAction } from "@crew/computer"
import { LIMITS, type ScreenshotPayload } from "@crew/shared"
import { truncate } from "@crew/shared/node"
import { tool, type Tool } from "ai"
import { z } from "zod"

// Most a single useScreen call may do before the model looks again
const MAX_ACTIONS = 12

type ScreenResult = Partial<ScreenshotPayload> & {
  completed?: number
  total?: number
  error?: string
  // The screen matched the previous screenshot, so the image was left out
  unchanged?: boolean
}

// The model sees the screenshot as an image. A later turn only has the size
// (see stripImages), so it must not send a file part without a media type.
const screenOutput = ({ output }: { output: ScreenResult }) => {
  const lines: string[] = []
  if (output.total && output.total > 1) lines.push(`Did ${output.completed ?? 0} of ${output.total} actions.`)
  if (output.error) lines.push(`Action ${(output.completed ?? 0) + 1} failed: ${output.error}. The ones after it didn't run.`)
  lines.push(
    output.unchanged
      ? "The screen looks exactly as in your last screenshot. Doing the same thing again won't help; try something else."
      : `Screen ${output.width ?? "?"}x${output.height ?? "?"}`,
  )
  const value: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: { type: "data"; data: string } }
  > = [{ type: "text", text: lines.join("\n") }]
  if (output.base64) {
    value.push({
      type: "file",
      mediaType: output.mediaType ?? "image/jpeg",
      data: { type: "data", data: output.base64 },
    })
  }
  return { type: "content" as const, value }
}

// One flat shape for every action: small models fill a single object with a
// type far more reliably than they pick between several schemas
const coord = z.number().int().min(0)
const screenAction = z.object({
  type: z.enum(["click", "move", "drag", "scroll", "type", "key", "wait"]),
  x: coord.optional().describe("click, move, scroll"),
  y: coord.optional().describe("click, move, scroll"),
  button: z.enum(["left", "right", "middle"]).optional().describe("click"),
  double: z.boolean().optional().describe("click"),
  fromX: coord.optional().describe("drag"),
  fromY: coord.optional().describe("drag"),
  toX: coord.optional().describe("drag"),
  toY: coord.optional().describe("drag"),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("scroll"),
  amount: z.number().int().min(1).max(30).optional().describe("scroll, in notches"),
  text: z.string().optional().describe("type: typed at the cursor"),
  keys: z.string().optional().describe("key: a key or combination, e.g. 'Return', 'ctrl+l', 'cmd+shift+t'"),
  ms: z.number().int().min(0).max(5000).optional().describe("wait: for a page or app to load"),
})
type ScreenAction = z.infer<typeof screenAction>

// Checks each action has what its type needs, before any of them runs
function toDesktopAction(a: ScreenAction, i: number): DesktopAction {
  const need = (...fields: (keyof ScreenAction)[]) => {
    const missing = fields.filter((f) => a[f] === undefined || a[f] === "")
    if (missing.length) throw new Error(`Action ${i + 1} (${a.type}) needs ${missing.join(", ")}. Nothing was done.`)
  }
  switch (a.type) {
    case "click":
      need("x", "y")
      return { type: "click", x: a.x!, y: a.y!, button: a.button, double: a.double }
    case "move":
      need("x", "y")
      return { type: "move", x: a.x!, y: a.y! }
    case "drag":
      need("fromX", "fromY", "toX", "toY")
      return { type: "drag", fromX: a.fromX!, fromY: a.fromY!, toX: a.toX!, toY: a.toY! }
    case "scroll":
      need("x", "y", "direction")
      return { type: "scroll", x: a.x!, y: a.y!, direction: a.direction!, amount: a.amount }
    case "type":
      need("text")
      return { type: "type", text: a.text! }
    case "key":
      need("keys")
      return { type: "key", keys: a.keys! }
    case "wait":
      return { type: "wait", ms: a.ms ?? 1000 }
  }
}

// One tool set for both the cloud screen and the person's Mac. Each batch of
// actions returns a fresh screenshot so the model always sees the result.
export function computerTools(driver: ComputerDriver): Record<string, Tool> {
  const where = driver.kind === "cloud" ? "your screen on the shared cloud computer" : "the person's Mac"
  // A screenshot identical to the previous one this turn isn't sent again
  let lastShot: string | undefined
  const seen = (shot: ScreenshotPayload): ScreenResult => {
    const key = createHash("sha1").update(shot.base64).digest("hex")
    if (key === lastShot) return { width: shot.width, height: shot.height, mediaType: shot.mediaType, unchanged: true }
    lastShot = key
    return shot
  }
  const tools: Record<string, Tool> = {
    viewScreen: tool({
      description: `Take a screenshot of ${where}.`,
      inputSchema: z.object({}),
      execute: async (): Promise<ScreenResult> => seen(await driver.screenshot()),
      toModelOutput: screenOutput,
    }),
    useScreen: tool({
      description:
        `Do one or more mouse and keyboard actions on ${where}, in order, then get one screenshot of the result. ` +
        "Put steps whose outcome you can predict in one call, like clicking a field, typing and pressing Return. " +
        "Look first before a step that depends on what appears. Coordinates are those of the latest screenshot.",
      inputSchema: z.object({ actions: z.array(screenAction).min(1).max(MAX_ACTIONS) }),
      execute: async ({ actions }): Promise<ScreenResult> => {
        const { completed, error, ...shot } = await driver.act(actions.map(toDesktopAction))
        return { ...seen(shot), completed, total: actions.length, ...(error ? { error } : {}) }
      },
      toModelOutput: screenOutput,
    }),
    bash: tool({
      description:
        driver.kind === "cloud"
          ? "Run a shell command on the cloud computer (Ubuntu). Your files live in ~/workspace, shared with the other bots."
          : "Run a shell command on the person's Mac (zsh).",
      inputSchema: z.object({
        command: z.string(),
        timeoutSeconds: z.number().int().min(1).max(600).default(120),
      }),
      execute: async ({ command, timeoutSeconds }) => {
        const r = await driver.bash(command, { timeoutMs: timeoutSeconds * 1000 })
        return {
          exitCode: r.exitCode,
          stdout: truncate(r.stdout, LIMITS.maxToolTextLength),
          stderr: truncate(r.stderr, LIMITS.maxToolTextLength / 4),
        }
      },
    }),
    readFile: tool({
      description: "Read a text file.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => truncate(await driver.readFile(path), LIMITS.maxToolTextLength),
    }),
    writeFile: tool({
      description: "Create or overwrite a text file.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        await driver.writeFile(path, content)
        return `Wrote ${content.length} characters to ${path}`
      },
    }),
    listFiles: tool({
      description: "List a folder.",
      inputSchema: z.object({ path: z.string() }),
      execute: ({ path }) => driver.listFiles(path),
    }),
    openUrl: tool({
      description:
        driver.kind === "cloud"
          ? "Open a web page in your browser on the cloud computer. Logins saved by any bot are shared."
          : "Open a web page in the Mac's default browser.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: ({ url }) => driver.openUrl(url),
    }),
  }
  if (driver.openApp) {
    const openApp = driver.openApp.bind(driver)
    tools.openApp = tool({
      description: "Open an app by name, e.g. terminal, text editor, files or calculator. It answers with the name readApp needs.",
      inputSchema: z.object({ name: z.string() }),
      execute: ({ name }) => openApp(name),
    })
  }
  if (driver.saveLogins) {
    const saveLogins = driver.saveLogins.bind(driver)
    tools.saveLogins = tool({
      description: "Save the browser's signed-in sessions so other bots can reuse them. Call after logging in somewhere.",
      inputSchema: z.object({}),
      execute: async () => ({ savedDomains: await saveLogins() }),
    })
  }
  return tools
}

// Tool names whose stored outputs are screenshots. The single-action names
// are from before useScreen and still appear in older chats.
export const SCREEN_TOOLS = new Set([
  "viewScreen",
  "useScreen",
  "mouseClick",
  "mouseMove",
  "mouseDrag",
  "mouseScroll",
  "keyboardType",
  "keyboardPress",
])
