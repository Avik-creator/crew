import { db, deviceActions, deviceCommandRules, devices } from "@crew/db"
import { hashToken, randomToken } from "@crew/shared/node"
import { json } from "../lib/validate"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { notFound, requireUser, type AppEnv } from "../lib/http"
import { relay } from "../lib/relay"

async function ownDevice(userId: string, id: string) {
  const [d] = await db.select().from(devices).where(and(eq(devices.id, id), eq(devices.userId, userId)))
  return d ?? notFound("That computer")
}

const publicDevice = ({ tokenHash: _t, ...d }: typeof devices.$inferSelect) => ({ ...d, online: relay.isOnline(d.id) })

export const deviceRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const rows = await db.select().from(devices).where(eq(devices.userId, user.id)).orderBy(devices.createdAt)
    return c.json(rows.map(publicDevice))
  })
  // Links this Mac: the token is shown once and kept in the OS keychain
  .post("/", json(z.object({ name: z.string().trim().min(1).max(60), platform: z.string().max(30) })), async (c) => {
    const user = c.get("user")
    const token = randomToken(32)
    const [device] = await db
      .insert(devices)
      .values({ userId: user.id, ...c.req.valid("json"), tokenHash: hashToken(token) })
      .returning()
    return c.json({ device: publicDevice(device!), token }, 201)
  })
  .patch("/:id", json(z.object({ name: z.string().trim().min(1).max(60) })), async (c) => {
    const user = c.get("user")
    const d = await ownDevice(user.id, c.req.param("id"))
    const [updated] = await db.update(devices).set(c.req.valid("json")).where(eq(devices.id, d.id)).returning()
    return c.json(publicDevice(updated!))
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const d = await ownDevice(user.id, c.req.param("id"))
    await db.delete(devices).where(eq(devices.id, d.id))
    return c.body(null, 204)
  })
  .get("/:id/rules", async (c) => {
    const user = c.get("user")
    const d = await ownDevice(user.id, c.req.param("id"))
    return c.json(await db.select().from(deviceCommandRules).where(eq(deviceCommandRules.deviceId, d.id)))
  })
  .post(
    "/:id/rules",
    json(z.object({ pattern: z.string().trim().min(1).max(200), mode: z.enum(["always_allow", "always_ask", "deny"]) })),
    async (c) => {
      const user = c.get("user")
      const d = await ownDevice(user.id, c.req.param("id"))
      const [rule] = await db
        .insert(deviceCommandRules)
        .values({ userId: user.id, deviceId: d.id, ...c.req.valid("json") })
        .returning()
      return c.json(rule, 201)
    },
  )
  .delete("/:id/rules/:ruleId", async (c) => {
    const user = c.get("user")
    const d = await ownDevice(user.id, c.req.param("id"))
    await db
      .delete(deviceCommandRules)
      .where(and(eq(deviceCommandRules.id, c.req.param("ruleId")), eq(deviceCommandRules.deviceId, d.id)))
    return c.body(null, 204)
  })
  .get("/:id/activity", async (c) => {
    const user = c.get("user")
    const d = await ownDevice(user.id, c.req.param("id"))
    return c.json(
      await db
        .select()
        .from(deviceActions)
        .where(eq(deviceActions.deviceId, d.id))
        .orderBy(desc(deviceActions.createdAt))
        .limit(200),
    )
  })

export async function deviceFromToken(token: string | undefined) {
  if (!token) return null
  const [d] = await db.select().from(devices).where(eq(devices.tokenHash, hashToken(token)))
  return d ?? null
}
