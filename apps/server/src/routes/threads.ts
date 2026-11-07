import { ensureChief, liveReplies, routeGroupMessage, saveMessage } from "@crew/agent"
import { bots, db, messages, runs, threadMembers, threads } from "@crew/db"
import { groupInputSchema, sendMessageSchema, type TurnReason } from "@crew/shared"
import { json } from "../lib/validate"
import { and, desc, eq, inArray, lt } from "drizzle-orm"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { z } from "zod"

import { publish } from "../lib/bus"
import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { runner } from "../lib/runner"

export async function ownThread(userId: string, threadId: string) {
  const [t] = await db.select().from(threads).where(and(eq(threads.id, threadId), eq(threads.userId, userId)))
  return t ?? notFound("That conversation")
}

async function membersOf(threadIds: string[]) {
  if (!threadIds.length) return []
  return db.select().from(threadMembers).where(inArray(threadMembers.threadId, threadIds))
}

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  goal: z.string().trim().max(500).optional(),
  archived: z.boolean().optional(),
  botIds: z.array(z.string()).min(2).max(6).optional(),
})

export const threadRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    await ensureChief(user.id)
    const rows = await db
      .select()
      .from(threads)
      .where(and(eq(threads.userId, user.id), eq(threads.archived, c.req.query("archived") === "true")))
      .orderBy(desc(threads.lastMessageAt))
    const members = await membersOf(rows.map((t) => t.id))
    const active = await db
      .select({ threadId: runs.threadId, botId: runs.botId, runId: runs.id })
      .from(runs)
      .where(and(eq(runs.userId, user.id), eq(runs.status, "running")))
    return c.json(
      rows.map((t) => ({
        ...t,
        botIds: members.filter((m) => m.threadId === t.id).map((m) => m.botId),
        unread: t.lastMessageAt > t.lastReadAt,
        working: active.filter((r) => r.threadId === t.id).map((r) => r.botId),
        activeRuns: active.filter((r) => r.threadId === t.id).map((r) => ({ botId: r.botId, runId: r.runId })),
      })),
    )
  })
  .post("/groups", json(groupInputSchema), async (c) => {
    const user = c.get("user")
    const input = c.req.valid("json")
    const owned = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.userId, user.id), inArray(bots.id, input.botIds)))
    if (owned.length !== input.botIds.length) badRequest("Some of those bots aren't yours.")
    const thread = await db.transaction(async (tx) => {
      const [t] = await tx.insert(threads).values({ userId: user.id, kind: "group", name: input.name, goal: input.goal }).returning()
      await tx.insert(threadMembers).values(input.botIds.map((botId) => ({ threadId: t!.id, botId })))
      return t!
    })
    return c.json({ ...thread, botIds: input.botIds, unread: false, working: [], activeRuns: [] }, 201)
  })
  .get("/:id", async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    const members = await membersOf([thread.id])
    return c.json({ ...thread, botIds: members.map((m) => m.botId) })
  })
  .patch("/:id", json(updateSchema), async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    const { botIds, ...input } = c.req.valid("json")
    const [updated] = await db.update(threads).set(input).where(eq(threads.id, thread.id)).returning()
    if (botIds && thread.kind === "group") {
      await db.delete(threadMembers).where(eq(threadMembers.threadId, thread.id))
      await db.insert(threadMembers).values(botIds.map((botId) => ({ threadId: thread.id, botId })))
    }
    publish(user.id, { type: "thread.updated", threadId: thread.id })
    return c.json(updated)
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    if (thread.kind === "direct") badRequest("Delete the bot to remove its chat, or clear it instead.")
    await db.delete(threads).where(eq(threads.id, thread.id))
    return c.body(null, 204)
  })
  .post("/:id/clear", async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    await db.delete(messages).where(eq(messages.threadId, thread.id))
    await db.update(threads).set({ lastMessagePreview: "" }).where(eq(threads.id, thread.id))
    publish(user.id, { type: "thread.updated", threadId: thread.id, cleared: true })
    return c.body(null, 204)
  })
  .post("/:id/read", async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    await db.update(threads).set({ lastReadAt: new Date() }).where(eq(threads.id, thread.id))
    return c.body(null, 204)
  })
  .get("/:id/messages", async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    // ids: just these messages, for the app to add or refresh the ones an event named
    const ids = c.req.query("ids")?.split(",").filter(Boolean).slice(0, 50)
    const before = c.req.query("before")
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200)
    const rows = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, thread.id),
          ids ? inArray(messages.id, ids) : undefined,
          before ? lt(messages.createdAt, new Date(before)) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(ids ? ids.length : limit)
    return c.json(rows.reverse())
  })
  // The person writes: save the message, then start the bots that should answer
  .post("/:id/messages", json(sendMessageSchema), async (c) => {
    const user = c.get("user")
    const thread = await ownThread(user.id, c.req.param("id"))
    if (thread.kind === "bot") badRequest("This is a conversation between bots. Message one of them directly.")
    const input = c.req.valid("json")
    const parts = [
      { type: "text", text: input.text },
      ...input.images.map((img) => ({ type: "file", mediaType: img.mediaType, url: `data:${img.mediaType};base64,${img.base64}` })),
    ]
    const msg = await saveMessage({
      threadId: thread.id,
      role: "user",
      authorType: "user",
      authorId: user.id,
      parts,
      metadata: { authorType: "user", authorId: user.id, mentionBotIds: input.mentionBotIds },
      chainId: null,
    })
    await db.update(threads).set({ lastReadAt: new Date(), archived: false }).where(eq(threads.id, thread.id))
    publish(user.id, { type: "message.created", threadId: thread.id, messageId: msg.id })

    let botIds: string[]
    let reason: TurnReason = "chat"
    let routedReason: string | null = null
    if (thread.kind === "group") {
      const route = await routeGroupMessage({ threadId: thread.id, text: input.text, mentionBotIds: input.mentionBotIds })
      botIds = route.botIds
      routedReason = route.reason
      reason = "group"
    } else {
      botIds = (await membersOf([thread.id])).map((m) => m.botId)
    }
    const started = await Promise.all(
      botIds.map(async (botId) => {
        const runId = await runner.enqueue({
          threadId: thread.id,
          botId,
          reason,
          chainId: msg.id,
          hop: 0,
          triggerMessageId: msg.id,
        })
        return { botId, runId }
      }),
    )
    return c.json({ message: msg, runs: started, routedReason }, 201)
  })

export const runRoutes = new Hono<AppEnv>()
  .use(requireUser)
  // The reply a turn is writing, as AI SDK UI chunks. Each event's id is the
  // chunk's index, so a reconnecting app picks up where it left off.
  .get("/:id/stream", async (c) => {
    const user = c.get("user")
    const run = await ownRun(user.id, c.req.param("id"))
    const lastId = Number(c.req.header("last-event-id") ?? -1)
    return streamSSE(c, async (stream) => {
      // Finished long ago: the saved message is all there is
      if (run.status !== "queued" && run.status !== "running" && !liveReplies.has(run.id)) return
      // Writes go out in order, and all of them before the stream closes
      let writing = Promise.resolve()
      await new Promise<void>((resolve) => {
        const stop = liveReplies.follow(run.id, Number.isFinite(lastId) ? lastId : -1, {
          chunk: (chunk, index) => {
            writing = writing.then(() => stream.writeSSE({ event: "chunk", id: String(index), data: JSON.stringify(chunk) }))
          },
          end: resolve,
        })
        stream.onAbort(() => {
          stop()
          resolve()
        })
      })
      await writing
    })
  })
  .post("/:id/cancel", async (c) => {
    const user = c.get("user")
    const run = await ownRun(user.id, c.req.param("id"))
    await runner.cancel(run.id)
    return c.body(null, 204)
  })

async function ownRun(userId: string, runId: string) {
  const [row] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.userId, userId)))
  return row ?? notFound("That run")
}
