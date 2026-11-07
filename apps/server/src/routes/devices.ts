import { db, deviceActions, deviceCommandRules, devices } from "@crew/db"
import { hashToken, randomToken } from "@crew/shared/node"
import { json } from "../lib/validate"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { notFound, requireUser, type AppEnv } from "../lib/http"
import { relay } from "../lib/relay"

export async function ownDevice(userId: string, id: string) {
  const [d] = await db.select().from(devices).where(and(eq(devices.id, id), eq(devices.userId, userId)))
  return d ?? notFound("That computer")
}

const publicDevice = ({ tokenHash: _t, machineId: _m, ...d }: typeof devices.$inferSelect) => ({ ...d, online: relay.isOnline(d.id) })

export const deviceRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const rows = await db.select().from(devices).where(eq(devices.userId, user.id)).orderBy(devices.createdAt)
    return c.json(rows.map(publicDevice))
  })
  // Links this Mac: the token is shown once and kept in the OS keychain. A Mac
  // that was linked before gets its old record back with a new token, so its
  // bots, rules and history stay with it. It's found by the id the app kept,
  // or by its hardware id when the app's data was wiped.
  .post(
    "/",
    json(
      z.object({
        name: z.string().trim().min(1).max(60),
        platform: z.string().max(30),
        deviceId: z.string().max(64).optional(),
        machineId: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user")
      const { deviceId, ...values } = c.req.valid("json")
      const token = randomToken(32)
      const mine = eq(devices.userId, user.id)
      const [known] = deviceId
        ? await db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, deviceId), mine))
        : []
      const [same] =
        !known && values.machineId
          ? await db
              .select({ id: devices.id })
              .from(devices)
              .where(and(eq(devices.machineId, values.machineId), mine))
              .orderBy(desc(devices.createdAt))
              .limit(1)
          : []
      const reuse = known ?? same
      if (reuse) {
        const [device] = await db
          .update(devices)
          .set({ ...values, tokenHash: hashToken(token) })
          .where(eq(devices.id, reuse.id))
          .returning()
        return c.json({ device: publicDevice(device!), token })
      }
      const [device] = await db
        .insert(devices)
        .values({ userId: user.id, ...values, tokenHash: hashToken(token) })
        .returning()
      return c.json({ device: publicDevice(device!), token }, 201)
    },
  )
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
    // An unlinked Mac shouldn't keep taking work over a socket it already opened
    await relay.drop(d.id)
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
