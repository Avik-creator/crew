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
