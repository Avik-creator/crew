import type { AppEvent } from "@crew/shared"

type Listener = (event: AppEvent) => void

// In-process fan-out of events to each person's open apps (one server process)
const listeners = new Map<string, Set<Listener>>()

export function publish(userId: string, event: AppEvent) {
  for (const fn of listeners.get(userId) ?? []) fn(event)
}

export function subscribe(userId: string, fn: Listener) {
  let set = listeners.get(userId)
  if (!set) listeners.set(userId, (set = new Set()))
  set.add(fn)
  // Safe to call twice: a stream that ended late must not drop the set a
  // newer connection of the same person made after this one emptied the old
  return () => {
    set.delete(fn)
    if (!set.size && listeners.get(userId) === set) listeners.delete(userId)
  }
}

export const isOnline = (userId: string) => (listeners.get(userId)?.size ?? 0) > 0
