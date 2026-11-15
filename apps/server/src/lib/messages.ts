import { routeGroupMessage, saveMessage } from "@crew/agent"
import { db, threadMembers, threads, type Thread } from "@crew/db"
import type { TurnReason } from "@crew/shared"
import { eq } from "drizzle-orm"

import { publish } from "./bus"
import { runner } from "./runner"

export type UserMessageInput = {
  text: string
  mentionBotIds?: string[]
  images?: { mediaType: string; base64: string }[]
}

// The person writes, from the app or a chat bridge: save the message, then
// start the bots that should answer. `extra` lands in the message metadata.
export async function postUserMessage(userId: string, thread: Thread, input: UserMessageInput, extra: Record<string, unknown> = {}) {
  const user = { id: userId }
  const images = input.images ?? []
  const parts = [
    { type: "text", text: input.text },
    ...images.map((img) => ({ type: "file", mediaType: img.mediaType, url: `data:${img.mediaType};base64,${img.base64}` })),
  ]
  const msg = await saveMessage({
    threadId: thread.id,
    role: "user",
    authorType: "user",
    authorId: user.id,
    parts,
    metadata: { authorType: "user", authorId: user.id, mentionBotIds: input.mentionBotIds, ...extra },
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
    botIds = (await db.select().from(threadMembers).where(eq(threadMembers.threadId, thread.id))).map((m) => m.botId)
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
  return { message: msg, runs: started, routedReason }
}
