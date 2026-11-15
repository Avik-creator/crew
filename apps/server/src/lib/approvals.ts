import { rememberableCommand } from "@crew/agent"
import { approvals, bots, db, deviceCommandRules, messages, runs, toolPrefs } from "@crew/db"
import { and, eq, sql } from "drizzle-orm"

import { publish } from "./bus"
import { badRequest, notFound } from "./http"
import { runner } from "./runner"

type ToolPart = { type: string; state?: string; approval?: { id: string; approved?: boolean; reason?: string } }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Writes the decision into the stored tool part, the way the AI SDK expects
// to find it when the next turn continues the message. The row lock makes
// decisions on the same reply take turns, so exactly one sees nothing pending.
async function recordDecision(tx: Tx, threadId: string, approvalId: string, approved: boolean, reason?: string) {
  const [m] = await tx
    .select({ id: messages.id, parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), sql`${messages.parts} @> ${JSON.stringify([{ approval: { id: approvalId } }])}::jsonb`))
    .for("update")
  if (!m) return null
  const parts = m.parts as ToolPart[]
  const i = parts.findIndex((p) => p.state === "approval-requested" && p.approval?.id === approvalId)
  if (i === -1) return null
  parts[i] = { ...parts[i]!, state: "approval-responded", approval: { id: approvalId, approved, reason } }
  await tx.update(messages).set({ parts }).where(eq(messages.id, m.id))
  const stillPending = parts.some((p) => p.state === "approval-requested")
  return { messageId: m.id, stillPending }
}

export type Decision = { approved: boolean; remember?: boolean; reason?: string }

// Allows or denies one request, from the app or a chat bridge, and continues
// the bot once every request from that reply is decided
export async function decideApproval(userId: string, approvalId: string, { approved, remember = false, reason }: Decision) {
  const user = { id: userId }
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.userId, user.id)))
  if (!row) notFound("That request")
  if (row.status !== "pending") badRequest("That request was already decided.")
  if (remember && row.hard) badRequest("This action always needs your OK.")

  // Only the first decision wins; the record and the decision commit together
  const decision = await db.transaction(async (tx) => {
    const [won] = await tx
      .update(approvals)
      .set({ status: approved ? "approved" : "denied", remember, decidedAt: new Date() })
      .where(and(eq(approvals.id, row.id), eq(approvals.userId, user.id), eq(approvals.status, "pending")))
      .returning({ id: approvals.id })
    if (!won) return null
    const result = row.threadId && row.toolCallId ? await recordDecision(tx, row.threadId, row.toolCallId, approved, reason) : null
    return { result }
  })
  if (!decision) badRequest("That request was already decided.")
  if (approved && remember) {
    if (row.kind === "mcp" && row.serverId) {
      await db
        .insert(toolPrefs)
        .values({ userId: user.id, serverId: row.serverId, toolName: row.toolName, mode: "always_allow" })
        .onConflictDoUpdate({ target: [toolPrefs.userId, toolPrefs.serverId, toolPrefs.toolName], set: { mode: "always_allow" } })
    }
    if (row.kind === "device" && row.toolName === "bash") {
      const [bot] = await db.select({ deviceId: bots.deviceId }).from(bots).where(eq(bots.id, row.botId))
      const command = rememberableCommand(String(row.input.command ?? ""))
      if (bot?.deviceId && command) {
        await db.insert(deviceCommandRules).values({ userId: user.id, deviceId: bot.deviceId, pattern: command, mode: "always_allow" })
      }
    }
  }
  publish(user.id, { type: "approval.resolved", approvalId: row.id })

  // Continue the bot once every request from that reply is decided
  const { result } = decision
  if (row.threadId && result) {
    // The reply now carries the decision; the app refreshes just that message
    publish(user.id, { type: "message.created", threadId: row.threadId, messageId: result.messageId })
    if (!result.stillPending) {
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
  return row
}
