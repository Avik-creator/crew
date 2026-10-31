import { db, memories } from "@crew/db"
import { tool } from "ai"
import { and, eq, isNull } from "drizzle-orm"
import { z } from "zod"

import type { TurnContext } from "../context"

const scope = (ctx: TurnContext, shared: boolean) =>
  and(eq(memories.userId, ctx.userId), shared ? isNull(memories.botId) : eq(memories.botId, ctx.bot.id))

// Memories are short facts keyed by name. Private ones belong to this bot;
// shared ones are facts about the person every bot reads.
export function memoryTools(ctx: TurnContext) {
  return {
    remember: tool({
      description:
        "Save a fact for future conversations (preferences, names, how the person likes things done). " +
        "Use shared=true for facts about the person that every bot should know.",
      inputSchema: z.object({
        key: z.string().min(1).max(80).describe("Short name, e.g. 'preferred-language'"),
        content: z.string().min(1).max(2000),
        category: z.enum(["preference", "person", "project", "process", "general"]).default("general"),
        shared: z.boolean().default(false),
      }),
      execute: async ({ key, content, category, shared }) => {
        const where = and(scope(ctx, shared), eq(memories.key, key))
        const [existing] = await db.select({ id: memories.id }).from(memories).where(where)
        if (existing) {
          await db.update(memories).set({ content, category }).where(eq(memories.id, existing.id))
        } else {
          await db.insert(memories).values({ userId: ctx.userId, botId: shared ? null : ctx.bot.id, key, content, category })
        }
        return `Remembered "${key}"${shared ? " for every bot" : ""}.`
      },
    }),
    forget: tool({
      description: "Delete a saved fact that is wrong or no longer true.",
      inputSchema: z.object({ key: z.string(), shared: z.boolean().default(false) }),
      execute: async ({ key, shared }) => {
        const rows = await db
          .delete(memories)
          .where(and(scope(ctx, shared), eq(memories.key, key)))
          .returning({ id: memories.id })
        return rows.length ? `Forgot "${key}".` : `Nothing saved as "${key}".`
      },
    }),
  }
}

// Every fact this bot can see, for the system prompt
export async function loadMemories(userId: string, botId: string) {
  const rows = await db.select().from(memories).where(eq(memories.userId, userId))
  return {
    shared: rows.filter((m) => m.botId === null),
    own: rows.filter((m) => m.botId === botId),
  }
}
