import { useSyncExternalStore } from "react"

import type { ActiveRun } from "./types"

// Runs streaming right now, by thread. Fed by message sends and SSE events.
let runs: Record<string, ActiveRun[]> = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const liveRuns = {
  add(threadId: string, run: ActiveRun) {
    const list = runs[threadId] ?? []
    if (list.some((r) => r.triggerRunId === run.triggerRunId)) return
    runs = { ...runs, [threadId]: [...list.filter((r) => r.botId !== run.botId), run] }
    emit()
  },
  remove(threadId: string, botId: string) {
    const list = runs[threadId]
    if (!list) return
    runs = { ...runs, [threadId]: list.filter((r) => r.botId !== botId) }
    emit()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
}

const EMPTY: ActiveRun[] = []
export function useLiveRuns(threadId: string) {
  return useSyncExternalStore(liveRuns.subscribe, () => runs[threadId] ?? EMPTY)
}
