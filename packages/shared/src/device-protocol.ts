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
] as const
export type LocalToolName = (typeof localToolNames)[number]

export const deviceCapabilitiesSchema = z.object({
  shell: z.boolean(),
  files: z.boolean(),
  screen: z.boolean(),
  input: z.boolean(),
  stdioMcp: z.boolean(),
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
  z.object({ type: z.literal("result"), id: z.string(), ok: z.literal(true), output: z.unknown() }),
  z.object({ type: z.literal("result"), id: z.string(), ok: z.literal(false), error: z.string() }),
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
