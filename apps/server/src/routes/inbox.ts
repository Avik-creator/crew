import { saveMessage } from "@crew/agent"
import { approvals, bots, db, takeovers } from "@crew/db"
import { json } from "../lib/validate"
import { and, desc, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { decideApproval } from "../lib/approvals"
import { publish } from "../lib/bus"
import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { runner } from "../lib/runner"

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
    await decideApproval(c.get("user").id, c.req.param("id"), c.req.valid("json"))
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
      const [won] = await db
        .update(takeovers)
        .set({ status, note, decidedAt: new Date() })
        .where(and(eq(takeovers.id, row.id), eq(takeovers.userId, user.id), eq(takeovers.status, "pending")))
        .returning({ id: takeovers.id })
      if (!won) badRequest("Already handled.")
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
