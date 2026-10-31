import { removeSchedule, syncSchedule } from "@crew/agent"
import { bots, db, schedules } from "@crew/db"
import { TRIGGER } from "@crew/shared"
import { json } from "../lib/validate"
import { tasks } from "@trigger.dev/sdk"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"

const scheduleSchema = z
  .object({
    botId: z.string(),
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(4000),
    cron: z.string().trim().max(100).nullable().optional(),
    runAt: z.coerce.date().nullable().optional(),
    timeZone: z.string().max(60).default("UTC"),
    enabled: z.boolean().default(true),
  })
  .refine((s) => !!s.cron !== !!s.runAt, { message: "Choose either a repeating schedule or a single time." })

async function ownSchedule(userId: string, id: string) {
  const [row] = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.userId, userId)))
  return row ?? notFound("That schedule")
}

async function sync(row: typeof schedules.$inferSelect) {
  try {
    const triggerScheduleId = await syncSchedule(row)
    const [updated] = await db.update(schedules).set({ triggerScheduleId }).where(eq(schedules.id, row.id)).returning()
    return updated!
  } catch (err) {
    badRequest(err instanceof Error ? err.message : "Couldn't save that schedule.")
  }
}

export const scheduleRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    return c.json(await db.select().from(schedules).where(eq(schedules.userId, user.id)).orderBy(desc(schedules.createdAt)))
  })
  .post("/", json(scheduleSchema), async (c) => {
    const user = c.get("user")
    const input = c.req.valid("json")
    const [bot] = await db.select().from(bots).where(and(eq(bots.id, input.botId), eq(bots.userId, user.id)))
    if (!bot) notFound("That bot")
    const [row] = await db
      .insert(schedules)
      .values({ ...input, cron: input.cron ?? null, runAt: input.runAt ?? null, userId: user.id })
      .returning()
    return c.json(await sync(row!), 201)
  })
  .patch("/:id", json(scheduleSchema), async (c) => {
    const user = c.get("user")
    const current = await ownSchedule(user.id, c.req.param("id"))
    const input = c.req.valid("json")
    const [row] = await db
      .update(schedules)
      .set({ ...input, cron: input.cron ?? null, runAt: input.runAt ?? null })
      .where(eq(schedules.id, current.id))
      .returning()
    return c.json(await sync({ ...row!, triggerScheduleId: current.triggerScheduleId }))
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const row = await ownSchedule(user.id, c.req.param("id"))
    await removeSchedule(row)
    await db.delete(schedules).where(eq(schedules.id, row.id))
    return c.body(null, 204)
  })
  .post("/:id/run", async (c) => {
    const user = c.get("user")
    const row = await ownSchedule(user.id, c.req.param("id"))
    const handle = await tasks.trigger(TRIGGER.scheduledTurnOnce, { scheduleId: row.id })
    return c.json({ triggerRunId: handle.id })
  })
