import { z } from "zod"

import { BOT_INSTRUCTIONS_MAX, BOT_JOB_MAX, BOT_NAME_MAX, LIMITS } from "./constants"

export const botInputSchema = z.object({
  name: z.string().trim().min(1, "Give your bot a name.").max(BOT_NAME_MAX),
  job: z.string().trim().min(1, "Tell your bot what its job is.").max(BOT_JOB_MAX),
  instructions: z.string().trim().max(BOT_INSTRUCTIONS_MAX).optional().default(""),
  model: z.string().trim().max(200).optional().nullable(),
  runsOn: z.enum(["cloud", "device"]).default("cloud"),
  deviceId: z.string().optional().nullable(),
  avatar: z.string().optional(),
  wakeBudgetDaily: z.number().int().min(0).max(1000).optional(),
})
export type BotInput = z.infer<typeof botInputSchema>

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(50),
  goal: z.string().trim().max(500).optional().default(""),
  botIds: z
    .array(z.string())
    .min(LIMITS.groupMinBots, `Pick at least ${LIMITS.groupMinBots} bots.`)
    .max(LIMITS.groupMaxBots, `A group holds at most ${LIMITS.groupMaxBots} bots.`),
})
export type GroupInput = z.infer<typeof groupInputSchema>

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(20_000),
  // Bots @mentioned or replied to; routing skips the router when present
  mentionBotIds: z.array(z.string()).optional().default([]),
  // Connector slugs attached with @, e.g. ["gitlab"]
  attachServerIds: z.array(z.string()).optional().default([]),
  images: z
    .array(z.object({ mediaType: z.string(), base64: z.string() }))
    .max(10)
    .optional()
    .default([]),
})
export type SendMessageInput = z.infer<typeof sendMessageSchema>

export type ThreadKind = "direct" | "group" | "bot"

// Metadata stamped on every stored UI message
export type CrewMessageMetadata = {
  authorType: "user" | "bot" | "system"
  authorId?: string | null
  botId?: string | null
  createdAt?: string
  runId?: string | null
  routedReason?: string | null
}

// Prefixed MCP tool names: "<serverSlug>__<toolName>"
export const MCP_TOOL_SEPARATOR = "__"
