import { bots, db, threadMembers, threads, takeovers } from "@crew/db"
import { LIMITS } from "@crew/shared"
import { tool, type Tool } from "ai"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"

import type { TurnContext } from "../context"
import { botPairThread, saveMessage } from "../store"

async function findBot(ctx: TurnContext, name: string) {
  const list = await db
    .select()
    .from(bots)
    .where(and(eq(bots.userId, ctx.userId), ne(bots.id, ctx.bot.id), ne(bots.status, "hidden")))
  const wanted = name.trim().replace(/^@/, "").toLowerCase()
  return list.find((b) => b.name.toLowerCase() === wanted)
}

// Tools for working with teammates and the person. Every bot-to-bot step adds
// a hop to the chain; past LIMITS.maxHops the tools refuse, which ends loops.
export function collabTools(ctx: TurnContext, originThreadId: string | null): Record<string, Tool> {
  const nextHop = ctx.payload.hop + 1
  const tooDeep = nextHop > LIMITS.maxHops

  const tools: Record<string, Tool> = {
    messageBot: tool({
      description:
        "Send a message to another bot on the team, e.g. to ask for help with something in its job. " +
        "Their answer comes back to you later in this conversation. Don't wait for it in this turn.",
      inputSchema: z.object({ to: z.string().describe("The bot's name"), message: z.string().min(1) }),
      execute: async ({ to, message }) => {
        if (tooDeep) return "Not sent: this chain of bot messages is already long. Summarize for the person instead."
        const target = await findBot(ctx, to)
        if (!target) return `There's no bot called "${to}" on the team.`
        if (target.status === "paused") return `${target.name} is paused right now.`
        const threadId = await botPairThread(ctx.userId, ctx.bot.id, target.id)
        const msg = await saveMessage({
          threadId,
          role: "assistant",
          authorType: "bot",
          authorId: ctx.bot.id,
          parts: [{ type: "text", text: message }],
          addressedToBotId: target.id,
          chainId: ctx.payload.chainId,
          hop: nextHop,
          runId: ctx.runId,
          metadata: { authorType: "bot", botId: ctx.bot.id, originThreadId },
        })
        await ctx.events.emit(ctx.userId, { type: "message.created", threadId, messageId: msg.id, botId: ctx.bot.id })
        await ctx.dispatcher.enqueue({
          threadId,
          botId: target.id,
          reason: "bot_message",
          chainId: ctx.payload.chainId,
          hop: nextHop,
          triggerMessageId: msg.id,
          background: true,
        })
        return `Sent to ${target.name}. You'll get their answer here when they reply.`
      },
    }),

    requestTakeover: tool({
      description:
        "Ask the person to take over your screen for something only they can do (a login, a captcha, a 2FA code, a payment). " +
        "Your turn ends; you continue when they're done.",
      inputSchema: z.object({
        reason: z.string().describe("Why you need them, in one sentence"),
        instruction: z.string().describe("Exactly what they should do"),
      }),
      execute: async ({ reason, instruction }) => {
        const [row] = await db
          .insert(takeovers)
          .values({ userId: ctx.userId, runId: ctx.runId, botId: ctx.bot.id, threadId: ctx.thread.id, reason, instruction })
          .returning({ id: takeovers.id })
        await ctx.events.emit(ctx.userId, {
          type: "takeover.requested",
          takeoverId: row!.id,
          threadId: ctx.thread.id,
          botId: ctx.bot.id,
        })
        await ctx.events.emit(ctx.userId, {
          type: "notify",
          title: `${ctx.bot.name} needs you`,
          body: reason,
          threadId: ctx.thread.id,
        })
        return `Asked ${ctx.userName} to take over. Stop here and wait.`
      },
    }),
  }

  if (ctx.thread.kind === "group") {
    tools.handoff = tool({
      description: "Pass the work to another bot in this group when the next step is its job. It will pick up right after you.",
      inputSchema: z.object({ to: z.string().describe("The bot's name"), note: z.string().describe("What it should do next") }),
      execute: async ({ to, note }) => {
        if (tooDeep) return "Not handed off: the chain is already long. Wrap up for the person instead."
        const target = await findBot(ctx, to)
        const [member] = target
          ? await db
              .select()
              .from(threadMembers)
              .where(and(eq(threadMembers.threadId, ctx.thread.id), eq(threadMembers.botId, target.id)))
          : []
        if (!target || !member) return `"${to}" isn't in this group.`
        await db.update(threads).set({ currentOwnerBotId: target.id }).where(eq(threads.id, ctx.thread.id))
        await ctx.dispatcher.enqueue({
          threadId: ctx.thread.id,
          botId: target.id,
          reason: "handoff",
          chainId: ctx.payload.chainId,
          hop: nextHop,
          background: ctx.background,
        })
        return `Handed off to ${target.name}: ${note}`
      },
    })
  }

  return tools
}
