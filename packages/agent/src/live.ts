import type { UIMessageChunk } from "ai"

type Follower = { chunk: (chunk: UIMessageChunk, index: number) => void; end: () => void }
type Entry = { chunks: UIMessageChunk[]; followers: Set<Follower>; done: boolean }

// The reply each turn is writing, kept in memory so an app that opens the
// chat halfway through still gets every chunk from the start
const entries = new Map<string, Entry>()
// A finished reply stays a little while for apps that are still catching up
const KEEP_AFTER_MS = 60_000

function entry(runId: string) {
  let e = entries.get(runId)
  if (!e) entries.set(runId, (e = { chunks: [], followers: new Set(), done: false }))
  return e
}

export const liveReplies = {
  has(runId: string) {
    return entries.has(runId)
  },

  push(runId: string, chunk: UIMessageChunk) {
    const e = entry(runId)
    if (e.done) return
    const index = e.chunks.push(chunk) - 1
    for (const f of e.followers) f.chunk(chunk, index)
  },

  end(runId: string) {
    const e = entry(runId)
    if (e.done) return
    e.done = true
    for (const f of e.followers) f.end()
    e.followers.clear()
    setTimeout(() => entries.delete(runId), KEEP_AFTER_MS).unref()
  },

  // Replays the chunks after `after` (-1 for all), then follows new ones
  follow(runId: string, after: number, follower: Follower): () => void {
    const e = entry(runId)
    for (let i = after + 1; i < e.chunks.length; i++) follower.chunk(e.chunks[i]!, i)
    if (e.done) {
      follower.end()
      return () => {}
    }
    e.followers.add(follower)
    return () => void e.followers.delete(follower)
  },
}
