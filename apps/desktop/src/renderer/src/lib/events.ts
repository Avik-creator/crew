import type { AppEvent } from "@crew/shared"
import { fetchEventSource } from "@microsoft/fetch-event-source"

import { serverBase, sessionToken } from "./api"
import { liveRuns } from "./live"
import { keys, queryClient } from "./queries"

const invalidate = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })

function handle(event: AppEvent) {
  switch (event.type) {
    case "message.created":
      invalidate(keys.messages(event.threadId))
      invalidate(keys.threads)
      return
    case "thread.updated":
      invalidate(keys.threads)
      invalidate(keys.messages(event.threadId))
      return
    case "team.updated":
      invalidate(keys.bots)
      invalidate(keys.threads)
      invalidate(keys.schedules)
      return
    case "run.started":
      liveRuns.add(event.threadId, { botId: event.botId, triggerRunId: event.triggerRunId })
      invalidate(keys.threads)
      return
    case "run.finished":
      // Let the saved message land before the live one disappears
      invalidate(keys.messages(event.threadId))
      setTimeout(() => liveRuns.remove(event.threadId, event.botId), 400)
      invalidate(keys.threads)
      return
    case "approval.requested":
    case "approval.resolved":
      invalidate(keys.approvals)
      return
    case "takeover.requested":
    case "takeover.resolved":
      invalidate(keys.takeovers)
      return
    case "computer.status":
      invalidate(keys.me)
      return
    case "device.status":
      invalidate(keys.devices)
      return
    case "connection.updated":
      invalidate(keys.connectors)
      return
    case "notify":
      void window.crew.notify({ title: event.title, body: event.body, path: event.threadId ? `/t/${event.threadId}` : undefined })
      return
  }
}

// One live connection per window; reconnects on its own
export function connectEvents() {
  const ctrl = new AbortController()
  void fetchEventSource(`${serverBase()}/events`, {
    headers: { authorization: `Bearer ${sessionToken()}` },
    signal: ctrl.signal,
    openWhenHidden: true,
    onmessage(msg) {
      if (msg.event !== "app") return
      try {
        handle(JSON.parse(msg.data) as AppEvent)
      } catch {
        // ignore malformed events
      }
    },
    onerror() {
      return 3000
    },
  })
  return () => ctrl.abort()
}
