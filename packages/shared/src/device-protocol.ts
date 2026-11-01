import { z } from "zod"

// Messages between the device relay (server) and the device agent (desktop app).
// The device dials out; nothing listens on the laptop. Every frame is validated
// on both ends and unknown types are dropped.

export const localToolNames = [
  "bash",
  "readFile",
  "writeFile",
  "listFiles",
  "viewScreen",
  "showScreen",
  "mouseClick",
  "mouseMove",
  "mouseDrag",
  "mouseScroll",
  "keyboardType",
  "keyboardPress",
  "openApp",
  "openUrl",
  // Apps through the accessibility tree (agent-desktop on the Mac)
  "listApps",
  "readApp",
  "useApp",
] as const
export type LocalToolName = (typeof localToolNames)[number]

export const deviceCapabilitiesSchema = z.object({
  shell: z.boolean(),
  files: z.boolean(),
  screen: z.boolean(),
  input: z.boolean(),
  stdioMcp: z.boolean(),
  // agent-desktop is installed, so bots can read and use apps by their UI tree
  apps: z.boolean().default(false),
})
export type DeviceCapabilities = z.infer<typeof deviceCapabilitiesSchema>

// Server → device
export const serverToDeviceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("invoke"),
    id: z.string(),
    runId: z.string(),
    botId: z.string(),
    botName: z.string(),
    tool: z.enum(localToolNames),
    input: z.record(z.string(), z.unknown()),
    // A background run has nobody watching the chat; approvals notify instead
    background: z.boolean(),
  }),
  z.object({
    type: z.literal("mcp_open"),
    sessionId: z.string(),
    serverId: z.string(),
    command: z.string(),
    args: z.array(z.string()),
    envKeys: z.array(z.string()),
  }),
  z.object({ type: z.literal("mcp_frame"), sessionId: z.string(), frame: z.unknown() }),
  z.object({ type: z.literal("mcp_close"), sessionId: z.string() }),
  z.object({ type: z.literal("cancel"), runId: z.string() }),
  z.object({ type: z.literal("pong") }),
])
export type ServerToDevice = z.infer<typeof serverToDeviceSchema>

// Device → server
export const deviceToServerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    appVersion: z.string(),
    platform: z.string(),
    capabilities: deviceCapabilitiesSchema,
    allowedPaths: z.array(z.string()),
  }),
  // ok=true carries output, ok=false carries error
  z.object({
    type: z.literal("result"),
    id: z.string(),
    ok: z.boolean(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("progress"), id: z.string(), chunk: z.string() }),
  z.object({
    type: z.literal("audit"),
    runId: z.string(),
    botId: z.string(),
    tool: z.string(),
    inputSummary: z.string(),
    decision: z.enum(["auto", "approved", "denied"]),
    exitCode: z.number().nullable(),
    durationMs: z.number(),
  }),
  z.object({ type: z.literal("mcp_frame"), sessionId: z.string(), frame: z.unknown() }),
  z.object({ type: z.literal("mcp_closed"), sessionId: z.string(), error: z.string().optional() }),
  // The kill switch: stop this run now
  z.object({ type: z.literal("kill"), runId: z.string() }),
  z.object({ type: z.literal("ping") }),
])
export type DeviceToServer = z.infer<typeof deviceToServerSchema>

// What a screenshot looks like on the wire, local or cloud
export type ScreenshotPayload = {
  base64: string
  mediaType: "image/jpeg" | "image/png"
  width: number
  height: number
}

// One step in an app, aimed at an element ref from the latest readApp.
// Shared because it crosses the wire from the server to the Mac.
export type AppAction =
  | { type: "click" | "right-click" | "focus" | "clear" | "check" | "uncheck" | "toggle" | "expand" | "collapse" | "scroll-to"; ref: string }
  | { type: "type" | "set-value"; ref: string; text: string }
  | { type: "select"; ref: string; option: string }
  | { type: "scroll"; ref: string; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "press"; keys: string; app?: string }

export type AppSnapshotOptions = {
  app: string
  // Drill into one element of an earlier snapshot
  root?: string
  // A shallow map of a big app, to drill into afterwards
  skeleton?: boolean
  // An open menu, sheet or alert
  surface?: "menu" | "sheet" | "alert"
}
