import type { Bot } from "./types"

// Mentions are stored as plain "@Name" text, so names with spaces or
// punctuation still read naturally to the bots. These helpers find them again.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// Longest names first, so "@Sales Outbound" wins over "@Sales"
export function mentionPattern(bots: Pick<Bot, "name">[]) {
  const names = bots.map((b) => b.name.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
  if (!names.length) return null
  return new RegExp(`(^|[^\\p{L}\\p{N}_@])@(${names.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "giu")
}

export const MENTION_HREF = "#mention:"

// Turns "@Name" into a link the markdown renderer draws as a chip. Code spans
// and fenced blocks are left alone.
export function linkMentions(markdown: string, bots: Pick<Bot, "id" | "name">[]) {
  const pattern = mentionPattern(bots)
  if (!pattern || !markdown.includes("@")) return markdown
  const byName = new Map(bots.map((b) => [b.name.trim().toLowerCase(), b.id]))
  return markdown
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((chunk, i) =>
      i % 2
        ? chunk
        : chunk.replace(pattern, (whole, lead: string, name: string) => {
            const id = byName.get(name.toLowerCase())
            return id ? `${lead}[@${name}](${MENTION_HREF}${id})` : whole
          }),
    )
    .join("")
}
