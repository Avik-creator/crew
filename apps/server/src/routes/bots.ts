import { botServers, bots, db, threadMembers, threads } from "@crew/db"
import { getScreenUpstream, releaseDisplay } from "@crew/computer"
import { botInputSchema } from "@crew/shared"
import { signToken } from "@crew/shared/node"
import { json } from "../lib/validate"
import { and, eq, ne } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"

export async function ownBot(userId: string, botId: string) {
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId)))
  return bot ?? notFound("That bot")
}

// Smallest display number not taken by another of the person's bots (:1, :2…)
async function freeDisplay(userId: string) {
  const used = new Set(
    (await db.select({ n: bots.displayNumber }).from(bots).where(eq(bots.userId, userId))).map((r) => r.n),
  )
  let n = 1
  while (used.has(n)) n++
  return n
}

async function setServers(botId: string, serverIds: string[]) {
  await db.delete(botServers).where(eq(botServers.botId, botId))
  if (serverIds.length) await db.insert(botServers).values(serverIds.map((serverId) => ({ botId, serverId })))
}

const createSchema = botInputSchema.extend({ serverIds: z.array(z.string()).optional().default([]) })
const updateSchema = botInputSchema.partial().extend({
  serverIds: z.array(z.string()).optional(),
  status: z.enum(["active", "paused"]).optional(),
})

export const botRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const rows = await db
      .select()
      .from(bots)
      .where(and(eq(bots.userId, user.id), ne(bots.status, "hidden")))
      .orderBy(bots.createdAt)
    const links = await db.select().from(botServers)
    const direct = await db
      .select({ threadId: threads.id, botId: threadMembers.botId })
      .from(threads)
      .innerJoin(threadMembers, eq(threadMembers.threadId, threads.id))
      .where(and(eq(threads.userId, user.id), eq(threads.kind, "direct")))
    return c.json(
      rows.map((b) => ({
        ...b,
        serverIds: links.filter((l) => l.botId === b.id).map((l) => l.serverId),
        directThreadId: direct.find((d) => d.botId === b.id)?.threadId ?? null,
      })),
    )
  })
  .post("/", json(createSchema), async (c) => {
    const user = c.get("user")
    const { serverIds, ...input } = c.req.valid("json")
    if (input.runsOn === "device" && !input.deviceId) badRequest("Pick which computer this bot works on.")
    const result = await db.transaction(async (tx) => {
      const displayNumber = await freeDisplay(user.id)
      const [bot] = await tx
        .insert(bots)
        .values({ ...input, avatar: input.avatar ?? "", userId: user.id, displayNumber })
        .returning()
      const [thread] = await tx.insert(threads).values({ userId: user.id, kind: "direct" }).returning()
      await tx.insert(threadMembers).values({ threadId: thread!.id, botId: bot!.id })
      return { bot: bot!, threadId: thread!.id }
    })
    await setServers(result.bot.id, serverIds)
    return c.json({ ...result.bot, serverIds, directThreadId: result.threadId }, 201)
  })
  .patch("/:id", json(updateSchema), async (c) => {
    const user = c.get("user")
    const bot = await ownBot(user.id, c.req.param("id"))
    const { serverIds, ...input } = c.req.valid("json")
    const [updated] = await db.update(bots).set(input).where(eq(bots.id, bot.id)).returning()
    if (serverIds) await setServers(bot.id, serverIds)
    return c.json(updated)
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const bot = await ownBot(user.id, c.req.param("id"))
    // Remove the bot's own threads; groups keep their history without it
    const direct = await db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(threadMembers, eq(threadMembers.threadId, threads.id))
      .where(and(eq(threadMembers.botId, bot.id), ne(threads.kind, "group")))
    for (const t of direct) await db.delete(threads).where(eq(threads.id, t.id))
    await db.delete(bots).where(eq(bots.id, bot.id))
    if (bot.runsOn === "cloud") void releaseDisplay(user.id, bot.displayNumber).catch(() => {})
    return c.body(null, 204)
  })
  // A one-minute ticket for the live screen socket, plus the VNC password
  .post("/:id/screen-ticket", async (c) => {
    const user = c.get("user")
    const bot = await ownBot(user.id, c.req.param("id"))
    if (bot.runsOn !== "cloud") badRequest(`${bot.name} works on your Mac, not the cloud computer.`)
    const { password } = await getScreenUpstream(user.id, bot.displayNumber)
    const ticket = signToken({ uid: user.id, display: bot.displayNumber }, 60)
    return c.json({ path: `/screen?ticket=${encodeURIComponent(ticket)}`, password })
  })
