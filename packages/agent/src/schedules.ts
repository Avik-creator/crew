import { bots, db, schedules, threadMembers, threads, type Schedule } from "@crew/db"
import { Cron } from "croner"
import { and, asc, eq, gt, isNull, lte } from "drizzle-orm"

import type { TurnDispatcher } from "./context"
import { saveMessage } from "./store"

const TICK_MS = 15_000

// When a schedule fires next after `after`, or null if it won't. Throws on a
// cron expression or time zone it can't read.
export function nextRunAt(row: Pick<Schedule, "cron" | "runAt" | "timeZone" | "enabled">, after = new Date()): Date | null {
  if (!row.enabled) return null
  if (row.cron) return new Cron(row.cron, { timezone: row.timeZone, paused: true }).nextRun(after)
  return row.runAt && row.runAt > after ? row.runAt : null
}

// Saves when the schedule fires next, after it was created or changed
export async function syncSchedule(row: Schedule): Promise<Schedule> {
  const [updated] = await db.update(schedules).set({ nextRunAt: nextRunAt(row) }).where(eq(schedules.id, row.id)).returning()
  return updated!
}

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
export async function fireSchedule(dispatcher: TurnDispatcher, row: Schedule) {
  const [bot] = await db.select().from(bots).where(eq(bots.id, row.botId))
  if (!bot || bot.status !== "active") return null
  const threadId = await directThread(row.userId, row.botId)
  const msg = await saveMessage({
    threadId,
    role: "user",
    authorType: "system",
    parts: [{ type: "text", text: row.prompt }],
    metadata: { authorType: "system", scheduleId: row.id, scheduleName: row.name },
  })
  await db.update(schedules).set({ lastRunAt: new Date() }).where(eq(schedules.id, row.id))
  const runId = await dispatcher.enqueue({
    threadId,
    botId: row.botId,
    reason: "schedule",
    chainId: msg.id,
    hop: 0,
    triggerMessageId: msg.id,
    background: true,
  })
  return { threadId, runId }
}

// Checks for due schedules every few seconds, with a timer for one due before
// the next check. A firing missed while the server was down runs once when
// it's back, late rather than never.
export function startScheduleClock(dispatcher: TurnDispatcher) {
  let soon: NodeJS.Timeout | undefined
  const tick = async () => {
    const now = new Date()
    const due = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
    for (const row of due) {
      const next = row.cron ? nextRunAt(row, now) : null
      // Moving nextRunAt claims the firing, so it happens once
      const [claimed] = await db
        .update(schedules)
        .set({ nextRunAt: next, ...(row.cron ? {} : { enabled: false }) })
        .where(and(eq(schedules.id, row.id), eq(schedules.nextRunAt, row.nextRunAt!)))
        .returning({ id: schedules.id })
      if (claimed) await fireSchedule(dispatcher, row).catch((err) => console.error(`Schedule "${row.name}" failed:`, err))
    }
    const [upcoming] = await db
      .select({ at: schedules.nextRunAt })
      .from(schedules)
      .where(and(eq(schedules.enabled, true), gt(schedules.nextRunAt, now)))
      .orderBy(asc(schedules.nextRunAt))
      .limit(1)
    const wait = upcoming?.at ? upcoming.at.getTime() - Date.now() : Infinity
    clearTimeout(soon)
    if (wait < TICK_MS) soon = setTimeout(run, Math.max(wait, 0) + 50)
  }

  // Schedules saved before this clock existed don't know when they fire next
  const backfill = async () => {
    const rows = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.enabled, true), isNull(schedules.nextRunAt)))
    for (const row of rows) await syncSchedule(row).catch((err) => console.error(`Schedule "${row.name}" can't be read:`, err))
  }

  const run = () => void tick().catch((err) => console.error("Schedule clock failed:", err))
  void backfill()
    .catch((err) => console.error("Schedule backfill failed:", err))
    .finally(run)
  const timer = setInterval(run, TICK_MS)
  return () => {
    clearInterval(timer)
    clearTimeout(soon)
  }
}
