import { bots, db, messages, type Message } from "@crew/db"
import { LIMITS } from "@crew/shared"
import type { UIMessage } from "ai"
import { desc, eq, inArray } from "drizzle-orm"

import { SCREEN_TOOLS } from "./tools/computer"

type AnyPart = { type: string; [k: string]: unknown }

const toolNameOf = (p: AnyPart) =>
  p.type === "dynamic-tool" ? String(p.toolName) : p.type.startsWith("tool-") ? p.type.slice(5) : null

// Screenshots go to the model while the turn runs; stored copies keep only the
// size. A later turn takes a fresh screenshot if it needs one.
export function stripImages(parts: unknown[]): unknown[] {
  return (parts as AnyPart[]).map((p) => {
    const name = toolNameOf(p)
    if (!name || !SCREEN_TOOLS.has(name) || !p.output || typeof p.output !== "object") return p
    const { width, height } = p.output as { width?: number; height?: number }
    return { ...p, output: { width, height, screenshot: "omitted" } }
  })
}

// What another author's message looks like to this bot: plain text with a
// name prefix, plus a line per handoff or bot message so context carries over
function asOtherAuthor(m: Message, name: string): UIMessage {
  const lines: string[] = []
  for (const p of m.parts as AnyPart[]) {
    if (p.type === "text" && p.text) lines.push(String(p.text))
    const tool = toolNameOf(p)
    if ((tool === "handoff" || tool === "messageBot") && p.input) {
      const input = p.input as { to?: string; note?: string; message?: string }
      lines.push(`(${tool === "handoff" ? "handed off to" : "messaged"} ${input.to}: ${input.note ?? input.message})`)
    }
  }
  return {
    id: m.id,
    role: "user",
    parts: [{ type: "text", text: `[${name}]: ${lines.join("\n") || "(no text)"}` }],
  }
}

// The thread from one bot's point of view, oldest first. Its own messages stay
// assistant messages with their tool parts; the person's stay user messages;
// everyone else becomes a named user message.
export async function loadHistory(threadId: string, botId: string, limit: number = LIMITS.historyMessages) {
  const rows = (
    await db.select().from(messages).where(eq(messages.threadId, threadId)).orderBy(desc(messages.createdAt)).limit(limit)
  ).reverse()
  const authorIds = [...new Set(rows.filter((m) => m.authorType === "bot" && m.authorId).map((m) => m.authorId!))]
  const authors = authorIds.length
    ? await db.select({ id: bots.id, name: bots.name }).from(bots).where(inArray(bots.id, authorIds))
    : []
  const names = new Map(authors.map((b) => [b.id, b.name]))

  const out: UIMessage[] = []
  for (const m of rows) {
    if (m.authorType === "bot" && m.authorId === botId) {
      out.push({ id: m.id, role: "assistant", parts: m.parts as UIMessage["parts"], metadata: m.metadata })
    } else if (m.authorType === "user") {
      const parts = (m.parts as AnyPart[]).filter((p) => p.type === "text" || p.type === "file")
      out.push({ id: m.id, role: "user", parts: parts as UIMessage["parts"] })
    } else if (m.authorType === "bot") {
      out.push(asOtherAuthor(m, names.get(m.authorId ?? "") ?? "Another bot"))
    } else {
      out.push(asOtherAuthor(m, "Note"))
    }
  }
  // A history can't start with a dangling assistant turn on some providers
  while (out[0]?.role === "assistant") out.shift()
  return out
}
