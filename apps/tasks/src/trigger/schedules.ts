import { enqueueTurn, saveMessage } from "@crew/agent"
import { bots, db, schedules as scheduleRows, threadMembers, threads } from "@crew/db"
import { TRIGGER } from "@crew/shared"
import { logger, schedules, task } from "@trigger.dev/sdk"
import { and, eq } from "drizzle-orm"

// The bot's direct thread with the person, created if it doesn't exist yet
async function directThread(userId: string, botId: string) {
  const [existing] = await db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(threadMembers, eq(threadMembers.threadId, threads.id))
    .where(and(eq(threads.userId, userId), eq(threads.kind, "direct"), eq(threadMembers.botId, botId)))
  if (existing) return existing.id
  const [t] = await db.insert(threads).values({ userId, kind: "direct" }).returning({ id: threads.id })
  await db.insert(threadMembers).values({ threadId: t!.id, botId })
  return t!.id
}

// Posts the schedule's prompt in the bot's direct thread and starts a
// background turn, so results land where the person already talks to the bot
async function fire(scheduleId: string) {
  const [row] = await db.select().from(scheduleRows).where(eq(scheduleRows.id, scheduleId))
  if (!row?.enabled) return { skipped: true }
  const [bot] = await db.select().from(bots).where(eq(bots.id, row.botId))
  if (!bot || bot.status !== "active") return { skipped: true }
  const threadId = await directThread(row.userId, row.botId)
  const msg = await saveMessage({
    threadId,
    role: "user",
    authorType: "system",
    parts: [{ type: "text", text: row.prompt }],
    metadata: { authorType: "system", scheduleId: row.id, scheduleName: row.name },
  })
  await db.update(scheduleRows).set({ lastRunAt: new Date() }).where(eq(scheduleRows.id, row.id))
  const handle = await enqueueTurn({
    threadId,
    botId: row.botId,
    reason: "schedule",
    chainId: msg.id,
    hop: 0,
    triggerMessageId: msg.id,
    background: true,
  })
  logger.info("Schedule fired", { schedule: row.name, run: handle.id })
  return { threadId, runId: handle.id }
}

export const scheduledTurn = schedules.task({
  id: TRIGGER.scheduledTurn,
  run: async (payload) => {
    if (!payload.externalId) return { skipped: true }
    return fire(payload.externalId)
  },
})

export const scheduledTurnOnce = task({
  id: TRIGGER.scheduledTurnOnce,
  run: async ({ scheduleId }: { scheduleId: string }) => {
    const result = await fire(scheduleId)
    await db.update(scheduleRows).set({ enabled: false, triggerScheduleId: null }).where(eq(scheduleRows.id, scheduleId))
    return result
  },
})
