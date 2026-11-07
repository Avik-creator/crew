import { db, messages, threadMembers, threads, type Message } from "@crew/db"
import { and, eq, inArray, sql } from "drizzle-orm"

type Part = { type: string; text?: string }

export function messageText(parts: unknown[]): string {
  return (parts as Part[])
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("\n")
    .trim()
}

export type NewMessage = {
  id?: string
  threadId: string
  role: "user" | "assistant" | "system"
  authorType: "user" | "bot" | "system"
  authorId?: string | null
  parts: unknown[]
  metadata?: Record<string, unknown>
  addressedToBotId?: string | null
  chainId?: string | null
  hop?: number
  runId?: string | null
}

// Inserts or, when the id exists (a continued turn), replaces the message,
// and moves the thread to the top with a fresh preview
export async function saveMessage(input: NewMessage): Promise<Message> {
  const text = messageText(input.parts)
  const values = { ...input, text }
  const [row] = await db
    .insert(messages)
    .values(values)
    .onConflictDoUpdate({
      target: messages.id,
      set: { parts: values.parts, metadata: values.metadata, text, runId: values.runId },
    })
    .returning()
  if (text) {
    await db
      .update(threads)
      .set({ lastMessagePreview: text.slice(0, 200), lastMessageAt: new Date() })
      .where(eq(threads.id, input.threadId))
  }
  return row!
}

// Tool calls a turn started but never finished: still running, or approved
// and waiting to run
const UNFINISHED = new Set(["input-streaming", "input-available", "approval-responded"])

// A turn that ended early leaves its tool calls without results. They're marked
// failed with the reason, so the chat stops showing them as running and the
// model isn't sent a call with no answer. Only this chain's messages change: an
// approved call of another chain may still be waiting for its turn.
export async function settleToolCalls(threadId: string, botId: string, chainId: string | null, reason: string) {
  if (!chainId) return []
  const rows = await db
    .select({ id: messages.id, parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.threadId, threadId), eq(messages.authorId, botId), eq(messages.chainId, chainId), eq(messages.role, "assistant")))
  const changed: string[] = []
  for (const row of rows) {
    const parts = row.parts as { type: string; state?: string; approval?: { approved?: boolean } }[]
    const open = (p: (typeof parts)[number]) =>
      (p.type.startsWith("tool-") || p.type === "dynamic-tool") && UNFINISHED.has(p.state ?? "") && p.approval?.approved !== false
    if (!parts.some(open)) continue
    await db
      .update(messages)
      .set({ parts: parts.map((p) => (open(p) ? { ...p, state: "output-error", errorText: reason } : p)) })
      .where(eq(messages.id, row.id))
    changed.push(row.id)
  }
  return changed
}

// The private thread two bots use to message each other, created on first use
export async function botPairThread(userId: string, a: string, b: string) {
  const [existing] = await db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(threadMembers, eq(threadMembers.threadId, threads.id))
    .where(and(eq(threads.userId, userId), eq(threads.kind, "bot"), inArray(threadMembers.botId, [a, b])))
    .groupBy(threads.id)
    .having(sql`count(*) = 2`)
  if (existing) return existing.id
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(threads).values({ userId, kind: "bot" }).returning({ id: threads.id })
    await tx.insert(threadMembers).values([
      { threadId: t!.id, botId: a },
      { threadId: t!.id, botId: b },
    ])
    return t!.id
  })
}
