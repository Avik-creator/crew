import { fireSchedule, nextRunAt } from "@crew/agent"
import { db, schedules } from "@crew/db"
import { json } from "../lib/validate"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { runner } from "../lib/runner"
import { ownBot } from "./bots"

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

// Reads the cron and time zone before anything is saved
function firstRun(input: z.infer<typeof scheduleSchema>) {
  try {
    return nextRunAt({ ...input, cron: input.cron ?? null, runAt: input.runAt ?? null })
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
    await ownBot(user.id, input.botId)
    const next = firstRun(input)
    const [row] = await db
      .insert(schedules)
      .values({ ...input, cron: input.cron ?? null, runAt: input.runAt ?? null, nextRunAt: next, userId: user.id })
      .returning()
    return c.json(row, 201)
  })
  .patch("/:id", json(scheduleSchema), async (c) => {
    const user = c.get("user")
    const current = await ownSchedule(user.id, c.req.param("id"))
    const input = c.req.valid("json")
    await ownBot(user.id, input.botId)
    const next = firstRun(input)
    const [row] = await db
      .update(schedules)
      .set({ ...input, cron: input.cron ?? null, runAt: input.runAt ?? null, nextRunAt: next })
      .where(eq(schedules.id, current.id))
      .returning()
    return c.json(row)
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const row = await ownSchedule(user.id, c.req.param("id"))
    await db.delete(schedules).where(eq(schedules.id, row.id))
    return c.body(null, 204)
  })
  .post("/:id/run", async (c) => {
    const user = c.get("user")
    // Runs it now, once; the schedule itself stays as it is
    const row = await ownSchedule(user.id, c.req.param("id"))
    const fired = await fireSchedule(runner, row)
    if (!fired) badRequest("That bot is paused, so it can't run now.")
    return c.json({ runId: fired.runId })
  })
