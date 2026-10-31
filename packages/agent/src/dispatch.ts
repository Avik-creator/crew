import type { Schedule } from "@crew/db"
import { TRIGGER, type AppEvent, type TurnPayload } from "@crew/shared"
import { internalFetch } from "@crew/shared/node"
import { auth, runs, schedules, tasks } from "@trigger.dev/sdk"

import type { EventSink, TurnDispatcher } from "./context"

// Trigger.dev implementations of the agent's interfaces, used by both the
// server (a person's message) and the tasks (bot-to-bot, handoffs, replies)

export async function enqueueTurn(payload: TurnPayload) {
  return tasks.trigger(TRIGGER.botTurn, payload, {
    // One turn per bot at a time; the next waits in line
    concurrencyKey: payload.botId,
    tags: [`bot_${payload.botId}`, `thread_${payload.threadId}`],
  })
}

export const triggerDispatcher: TurnDispatcher = {
  async enqueue(payload) {
    await enqueueTurn(payload)
  },
}

// Tasks run outside the server, so they post events to it over HTTP
export const httpEvents: EventSink = {
  async emit(userId: string, event: AppEvent) {
    await internalFetch("/internal/events", { method: "POST", body: JSON.stringify({ userId, event }) })
  },
}

// Read-only token the app uses to subscribe to one run's live stream
export function runStreamToken(triggerRunId: string) {
  return auth.createPublicToken({ scopes: { read: { runs: [triggerRunId] } }, expirationTime: "2h" })
}

export function cancelRun(triggerRunId: string) {
  return runs.cancel(triggerRunId)
}

// Recurring schedules are Trigger schedules keyed by our id; one-off ones are
// delayed runs. Returns the Trigger id to store on the row.
export async function syncSchedule(row: Schedule): Promise<string | null> {
  await removeSchedule(row)
  if (!row.enabled) return null
  if (row.cron) {
    const created = await schedules.create({
      task: TRIGGER.scheduledTurn,
      cron: row.cron,
      timezone: row.timeZone,
      externalId: row.id,
      deduplicationKey: `schedule-${row.id}`,
    })
    return created.id
  }
  if (row.runAt && row.runAt.getTime() > Date.now()) {
    const handle = await tasks.trigger(TRIGGER.scheduledTurnOnce, { scheduleId: row.id }, { delay: row.runAt })
    return handle.id
  }
  return null
}

export async function removeSchedule(row: Pick<Schedule, "cron" | "triggerScheduleId">) {
  if (!row.triggerScheduleId) return
  if (row.triggerScheduleId.startsWith("sched_")) await schedules.del(row.triggerScheduleId).catch(() => {})
  else await runs.cancel(row.triggerScheduleId).catch(() => {})
}
