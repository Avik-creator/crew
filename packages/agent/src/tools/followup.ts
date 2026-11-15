import { db, schedules } from "@crew/db"
import { tool, type Tool } from "ai"
import { and, eq, isNotNull } from "drizzle-orm"
import { z } from "zod"

import type { TurnContext } from "../context"

const MAX_PENDING = 20
const MAX_MINUTES = 30 * 24 * 60

// Lets any bot come back to this chat later on its own ("check the deploy in
// 20 minutes"). A follow-up is a one-off schedule tied to the chat, so it
// shows on the Schedules page and survives a server restart.
export function followUpTools(ctx: TurnContext): Record<string, Tool> {
  return {
    followUp: tool({
      description:
        "Come back to this conversation later by yourself, e.g. to check on something that takes time or to remind the person. " +
        "When it's time you get a new turn here with your note. Use inMinutes for 'in 20 minutes', or at for a set time.",
      inputSchema: z.object({
        note: z.string().min(1).max(1000).describe("What to do when you come back, written to yourself"),
        inMinutes: z.number().int().min(1).max(MAX_MINUTES).optional(),
        at: z.string().optional().describe("ISO date-time with offset, e.g. 2026-11-16T09:00:00+05:30"),
      }),
      execute: async ({ note, inMinutes, at }) => {
        if (!!inMinutes === !!at) return "Give either inMinutes or at."
        const when = inMinutes ? new Date(Date.now() + inMinutes * 60_000) : new Date(at!)
        if (Number.isNaN(when.getTime())) return `"${at}" isn't a date I can read.`
        if (when.getTime() <= Date.now()) return "That time has already passed."
        const pending = await db
          .select({ id: schedules.id })
          .from(schedules)
          .where(and(eq(schedules.botId, ctx.bot.id), eq(schedules.enabled, true), isNotNull(schedules.threadId)))
        if (pending.length >= MAX_PENDING) return `You already have ${MAX_PENDING} follow-ups waiting. Let some finish first.`
        await db.insert(schedules).values({
          userId: ctx.userId,
          botId: ctx.bot.id,
          threadId: ctx.thread.id,
          name: `Follow-up: ${note.length > 60 ? `${note.slice(0, 57)}...` : note}`,
          prompt: `Follow-up you set earlier: ${note}`,
          runAt: when,
          nextRunAt: when,
          enabled: true,
        })
        await ctx.events.emit(ctx.userId, { type: "team.updated" })
        return `Okay, I'll come back here at ${when.toISOString()}.`
      },
    }),
  }
}
