import type { ComputerDriver, DesktopAction } from "@crew/computer"
import { LIMITS, type ScreenshotPayload } from "@crew/shared"
import { truncate } from "@crew/shared/node"
import { tool, type Tool } from "ai"
import { z } from "zod"

// The model sees the screenshot as an image. A later turn only has the size
// (see stripImages), so it must not send a file part without a media type.
const screenOutput = ({
  output,
}: {
  output: Partial<ScreenshotPayload>
}) => {
  const value: Array<
    | { type: "text"; text: string }
    | { type: "file"; mediaType: string; data: { type: "data"; data: string } }
  > = [{ type: "text", text: `Screen ${output.width ?? "?"}x${output.height ?? "?"}` }]
  if (output.base64) {
    value.push({
      type: "file",
      mediaType: output.mediaType ?? "image/jpeg",
      data: { type: "data", data: output.base64 },
    })
  }
  return { type: "content" as const, value }
}

const point = { x: z.number().int().min(0), y: z.number().int().min(0) }

function action<S extends z.ZodObject>(
  driver: ComputerDriver,
  description: string,
  schema: S,
  toAction: (input: z.infer<S>) => DesktopAction,
) {
  return tool({
    description,
    inputSchema: schema,
    execute: (input: z.infer<S>) => driver.act(toAction(input)),
    toModelOutput: screenOutput,
  })
}

// One tool set for both the cloud screen and the person's Mac. Each action
// returns a fresh screenshot so the model always sees the result.
export function computerTools(driver: ComputerDriver): Record<string, Tool> {
  const where = driver.kind === "cloud" ? "your screen on the shared cloud computer" : "the person's Mac"
  const tools: Record<string, Tool> = {
    viewScreen: tool({
      description: `Take a screenshot of ${where}.`,
      inputSchema: z.object({}),
      execute: () => driver.screenshot(),
      toModelOutput: screenOutput,
    }),
    mouseClick: action(
      driver,
      "Click at a point on the screen. Use the coordinates of the latest screenshot.",
      z.object({ ...point, button: z.enum(["left", "right", "middle"]).default("left"), double: z.boolean().default(false) }),
      (i) => ({ type: "click", ...i }),
    ),
    mouseMove: action(driver, "Move the mouse to a point.", z.object(point), (i) => ({ type: "move", ...i })),
    mouseDrag: action(
      driver,
      "Drag from one point to another with the left button held.",
      z.object({ fromX: z.number().int(), fromY: z.number().int(), toX: z.number().int(), toY: z.number().int() }),
      (i) => ({ type: "drag", ...i }),
    ),
    mouseScroll: action(
      driver,
      "Scroll at a point.",
      z.object({ ...point, direction: z.enum(["up", "down", "left", "right"]), amount: z.number().int().min(1).max(30).default(5) }),
      (i) => ({ type: "scroll", ...i }),
    ),
    keyboardType: action(driver, "Type text at the cursor.", z.object({ text: z.string() }), (i) => ({ type: "type", ...i })),
    keyboardPress: action(
      driver,
      "Press a key or combination, e.g. 'Return', 'ctrl+l', 'cmd+shift+t', 'Escape'.",
      z.object({ keys: z.string() }),
      (i) => ({ type: "key", ...i }),
    ),
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
      description: "Open an application by name.",
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

// Tool names whose stored outputs are screenshots
export const SCREEN_TOOLS = new Set([
  "viewScreen",
  "mouseClick",
  "mouseMove",
  "mouseDrag",
  "mouseScroll",
  "keyboardType",
  "keyboardPress",
])
