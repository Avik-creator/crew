import { saveMessage } from "@crew/agent"
import { approvals, bots, db, deviceCommandRules, messages, runs, takeovers, toolPrefs } from "@crew/db"
import { json } from "../lib/validate"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { publish } from "../lib/bus"
import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { runner } from "../lib/runner"

type ToolPart = { type: string; state?: string; approval?: { id: string; approved?: boolean; reason?: string } }

// Writes the decision into the stored tool part, the way the AI SDK expects
// to find it when the next turn continues the message
async function recordDecision(threadId: string, approvalId: string, approved: boolean, reason?: string) {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(desc(messages.createdAt))
    .limit(20)
  for (const m of rows) {
    const parts = m.parts as ToolPart[]
    const i = parts.findIndex((p) => p.state === "approval-requested" && p.approval?.id === approvalId)
    if (i === -1) continue
    parts[i] = { ...parts[i]!, state: "approval-responded", approval: { id: approvalId, approved, reason } }
    await db.update(messages).set({ parts }).where(eq(messages.id, m.id))
    const stillPending = parts.some((p) => p.state === "approval-requested")
    return { messageId: m.id, stillPending }
  }
  return null
}

const decideSchema = z.object({
  approved: z.boolean(),
  remember: z.boolean().optional().default(false),
  reason: z.string().max(500).optional(),
})

export const inboxRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/approvals", async (c) => {
    const user = c.get("user")
    const status = (c.req.query("status") ?? "pending") as "pending"
    const rows = await db
      .select({ approval: approvals, botName: bots.name, botColor: bots.color })
      .from(approvals)
      .innerJoin(bots, eq(bots.id, approvals.botId))
      .where(and(eq(approvals.userId, user.id), eq(approvals.status, status)))
      .orderBy(desc(approvals.createdAt))
      .limit(100)
    return c.json(rows.map((r) => ({ ...r.approval, botName: r.botName, botColor: r.botColor })))
  })
  .post("/approvals/:id", json(decideSchema), async (c) => {
    const user = c.get("user")
    const { approved, remember, reason } = c.req.valid("json")
    const [row] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, c.req.param("id")), eq(approvals.userId, user.id)))
    if (!row) notFound("That request")
    if (row.status !== "pending") badRequest("That request was already decided.")
    if (remember && row.hard) badRequest("This action always needs your OK.")

    await db
      .update(approvals)
      .set({ status: approved ? "approved" : "denied", remember, decidedAt: new Date() })
      .where(eq(approvals.id, row.id))
    if (approved && remember) {
      if (row.kind === "mcp" && row.serverId) {
        await db
          .insert(toolPrefs)
          .values({ userId: user.id, serverId: row.serverId, toolName: row.toolName, mode: "always_allow" })
          .onConflictDoUpdate({ target: [toolPrefs.userId, toolPrefs.serverId, toolPrefs.toolName], set: { mode: "always_allow" } })
      }
      if (row.kind === "device" && row.toolName === "bash") {
        const [bot] = await db.select({ deviceId: bots.deviceId }).from(bots).where(eq(bots.id, row.botId))
        const command = String(row.input.command ?? "").trim()
        if (bot?.deviceId && command) {
          await db.insert(deviceCommandRules).values({ userId: user.id, deviceId: bot.deviceId, pattern: command, mode: "always_allow" })
        }
      }
    }
    publish(user.id, { type: "approval.resolved", approvalId: row.id })

    // Continue the bot once every request from that reply is decided
    if (row.threadId && row.toolCallId) {
      const result = await recordDecision(row.threadId, row.toolCallId, approved, reason)
      // The reply now carries the decision; the app refreshes just that message
      if (result) publish(user.id, { type: "message.created", threadId: row.threadId, messageId: result.messageId })
      if (result && !result.stillPending) {
        const [run] = row.runId ? await db.select().from(runs).where(eq(runs.id, row.runId)) : []
        await runner.enqueue({
          threadId: row.threadId,
          botId: row.botId,
          reason: "approval",
          chainId: run?.chainId ?? result.messageId,
          hop: run?.hop ?? 0,
        })
      }
    }
    return c.json({ ok: true })
  })
  .get("/takeovers", async (c) => {
    const user = c.get("user")
    const rows = await db
      .select({ takeover: takeovers, botName: bots.name, botColor: bots.color })
      .from(takeovers)
      .innerJoin(bots, eq(bots.id, takeovers.botId))
      .where(and(eq(takeovers.userId, user.id), eq(takeovers.status, "pending")))
      .orderBy(desc(takeovers.createdAt))
    return c.json(rows.map((r) => ({ ...r.takeover, botName: r.botName, botColor: r.botColor })))
  })
  .post(
    "/takeovers/:id",
    json(z.object({ status: z.enum(["completed", "skipped"]), note: z.string().max(2000).optional() })),
    async (c) => {
      const user = c.get("user")
      const { status, note } = c.req.valid("json")
      const [row] = await db
        .select()
        .from(takeovers)
        .where(and(eq(takeovers.id, c.req.param("id")), eq(takeovers.userId, user.id)))
      if (!row) notFound("That request")
      if (row.status !== "pending") badRequest("Already handled.")
      await db.update(takeovers).set({ status, note, decidedAt: new Date() }).where(eq(takeovers.id, row.id))
      publish(user.id, { type: "takeover.resolved", takeoverId: row.id })
      if (row.threadId) {
        const text =
          status === "completed"
            ? `I've done it${note ? `: ${note}` : "."} You can continue.`
            : `I skipped that${note ? `: ${note}` : "."} Find another way or tell me what you need.`
        const msg = await saveMessage({
          threadId: row.threadId,
          role: "user",
          authorType: "user",
          authorId: user.id,
          parts: [{ type: "text", text }],
          metadata: { authorType: "user", takeoverId: row.id },
        })
        publish(user.id, { type: "message.created", threadId: row.threadId, messageId: msg.id })
        await runner.enqueue({ threadId: row.threadId, botId: row.botId, reason: "takeover", chainId: msg.id, hop: 0, triggerMessageId: msg.id })
      }
      return c.json({ ok: true })
    },
  )
