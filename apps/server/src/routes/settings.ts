import { destroyComputer, getComputerStatus, pauseComputer } from "@crew/computer"
import { db, userSettings } from "@crew/db"
import { json } from "../lib/validate"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { requireUser, type AppEnv } from "../lib/http"

const settingsSchema = z.object({
  timeZone: z.string().max(60).optional(),
  askBeforeBotMessages: z.boolean().optional(),
  notifications: z.object({ replies: z.boolean(), approvals: z.boolean(), botMessages: z.boolean() }).optional(),
})

export const settingsRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/me", async (c) => {
    const user = c.get("user")
    let [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, user.id))
    if (!settings) [settings] = await db.insert(userSettings).values({ userId: user.id }).returning()
    const computer = await getComputerStatus(user.id)
    return c.json({
      user: { id: user.id, name: user.name, email: user.email, image: user.image },
      settings,
      computer: computer
        ? { status: computer.status, provider: computer.provider, lastActiveAt: computer.lastActiveAt, error: computer.error }
        : { status: "none" },
    })
  })
  .patch("/settings", json(settingsSchema), async (c) => {
    const user = c.get("user")
    const [row] = await db
      .insert(userSettings)
      .values({ userId: user.id, ...c.req.valid("json") })
      .onConflictDoUpdate({ target: userSettings.userId, set: c.req.valid("json") })
      .returning()
    return c.json(row)
  })
  .post("/computer/pause", async (c) => {
    const user = c.get("user")
    return c.json({ paused: await pauseComputer(user.id) })
  })
  // Throws the computer away; the next task starts a fresh one
  .post("/computer/reset", async (c) => {
    const user = c.get("user")
    await destroyComputer(user.id)
    return c.json({ ok: true })
  })
