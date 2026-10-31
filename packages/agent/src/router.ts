import { bots, db, messages, threadMembers, threads } from "@crew/db"
import { generateText, Output } from "ai"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { languageModel, ROUTER_MODEL } from "./model"

export type RouteResult = { botIds: string[]; reason: string }

const MAX_RESPONDERS = 2

// Picks who answers a message in a group: @mentions win outright, otherwise a
// small model reads the recent conversation and the members' jobs
export async function routeGroupMessage(opts: { threadId: string; text: string; mentionBotIds?: string[] }): Promise<RouteResult> {
  const members = await db
    .select({ id: bots.id, name: bots.name, job: bots.job, status: bots.status })
    .from(threadMembers)
    .innerJoin(bots, eq(bots.id, threadMembers.botId))
    .where(eq(threadMembers.threadId, opts.threadId))
  const active = members.filter((m) => m.status === "active")
  if (!active.length) return { botIds: [], reason: "Nobody in this group is active." }

  const mentioned = active.filter((m) => opts.mentionBotIds?.includes(m.id))
  if (mentioned.length) return { botIds: mentioned.map((m) => m.id), reason: "Mentioned by name." }
  if (active.length === 1) return { botIds: [active[0]!.id], reason: "Only member." }

  const [thread] = await db.select().from(threads).where(eq(threads.id, opts.threadId))
  const recent = (
    await db
      .select({ authorType: messages.authorType, authorId: messages.authorId, text: messages.text })
      .from(messages)
      .where(and(eq(messages.threadId, opts.threadId)))
      .orderBy(desc(messages.createdAt))
      .limit(8)
  ).reverse()
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? "Someone"
  const owner = active.find((m) => m.id === thread?.currentOwnerBotId)

  try {
    const { output } = await generateText({
      model: languageModel(ROUTER_MODEL()),
      output: Output.object({
        schema: z.object({
          responders: z.array(z.string()).max(MAX_RESPONDERS).describe("Names of the bots who should answer"),
          reason: z.string().describe("One short sentence"),
        }),
      }),
      prompt: [
        "You route messages in a group chat between a person and their AI teammates.",
        `Pick the 1 or ${MAX_RESPONDERS} bots whose jobs best fit the newest message. Prefer one. Pick two only if both are clearly needed.`,
        owner ? `${owner.name} is currently leading the work; keep it with them if the message continues that work.` : "",
        thread?.goal ? `Group goal: ${thread.goal}` : "",
        "",
        "Bots:",
        ...active.map((m) => `- ${m.name}: ${m.job}`),
        "",
        "Recent conversation:",
        ...recent.map((m) => `${m.authorType === "user" ? "Person" : nameOf(m.authorId)}: ${m.text.slice(0, 500)}`),
        `Person: ${opts.text}`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    })
    const picked = output.responders
      .map((name) => active.find((m) => m.name.toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is string => !!id)
    if (picked.length) return { botIds: [...new Set(picked)].slice(0, MAX_RESPONDERS), reason: output.reason }
  } catch {
    // Fall through to the owner or first member
  }
  return { botIds: [(owner ?? active[0])!.id], reason: owner ? "Continuing with the current lead." : "Default pick." }
}
