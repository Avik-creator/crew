import { createBot, ensureChief, setBotServers, setChiefDismissed } from "@crew/agent"
import { botServers, bots, db, mcpServers, threadMembers, threads } from "@crew/db"
import { getScreenUpstream, releaseDisplay } from "@crew/computer"
import { botInputSchema } from "@crew/shared"
import { signToken } from "@crew/shared/node"
import { json } from "../lib/validate"
import { and, eq, inArray, ne, or } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { publish } from "../lib/bus"
import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { ownDevice } from "./devices"

export async function ownBot(userId: string, botId: string) {
  const [bot] = await db.select().from(bots).where(and(eq(bots.id, botId), eq(bots.userId, userId)))
  return bot ?? notFound("That bot")
}

// Built-in connectors, plus custom ones this person added
async function usableServers(userId: string, serverIds: string[]) {
  const ids = [...new Set(serverIds)]
  if (!ids.length) return ids
  const found = await db
    .select({ id: mcpServers.id })
    .from(mcpServers)
    .where(and(inArray(mcpServers.id, ids), or(eq(mcpServers.isCustom, false), eq(mcpServers.addedByUserId, userId))))
  if (found.length !== ids.length) notFound("That connector")
  return ids
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
    await ensureChief(user.id)
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
    if (input.deviceId) await ownDevice(user.id, input.deviceId)
    const servers = await usableServers(user.id, serverIds)
    const result = await createBot(user.id, { ...input, serverIds: servers })
    // Other windows and devices refresh their sidebar
    publish(user.id, { type: "team.updated" })
    return c.json({ ...result.bot, serverIds: servers, directThreadId: result.threadId }, 201)
  })
  // Brings back the chief after the person removed it
  .post("/chief", async (c) => {
    const user = c.get("user")
    await setChiefDismissed(user.id, false)
    const chief = await ensureChief(user.id)
    publish(user.id, { type: "team.updated" })
    return c.json({ id: chief?.id ?? null }, 201)
  })
  .patch("/:id", json(updateSchema), async (c) => {
    const user = c.get("user")
    const bot = await ownBot(user.id, c.req.param("id"))
    const { serverIds, ...input } = c.req.valid("json")
    if (input.deviceId) await ownDevice(user.id, input.deviceId)
    const servers = serverIds && (await usableServers(user.id, serverIds))
    const [updated] = await db.update(bots).set(input).where(eq(bots.id, bot.id)).returning()
    if (servers) await setBotServers(bot.id, servers)
    publish(user.id, { type: "team.updated" })
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
    if (bot.role === "chief") await setChiefDismissed(user.id, true)
    if (bot.runsOn === "cloud") void releaseDisplay(user.id, bot.displayNumber).catch(() => {})
    publish(user.id, { type: "team.updated" })
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
