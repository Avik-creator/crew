import type { AppEvent } from "@crew/shared"
import { fetchEventSource } from "@microsoft/fetch-event-source"

import { serverBase, sessionToken } from "./api"
import { liveRuns } from "./live"
import { keys, messagesPulled, pullMessages, queryClient } from "./queries"

const invalidate = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })

function handle(event: AppEvent) {
  switch (event.type) {
    case "message.created":
      // Only the new message comes down, not the whole chat again
      void pullMessages(event.threadId, [event.messageId])
      invalidate(keys.threads)
      return
    case "thread.updated":
      invalidate(keys.threads)
      if (event.cleared) invalidate(keys.messages(event.threadId))
      return
    case "team.updated":
      invalidate(keys.bots)
      invalidate(keys.threads)
      invalidate(keys.schedules)
      return
    case "run.started":
      liveRuns.add(event.threadId, { botId: event.botId, runId: event.runId })
      invalidate(keys.threads)
      return
    case "run.finished":
      // The live reply stays until the saved one is in, so it never blinks out.
      // Its message.created came first, so waiting on the pulls is enough.
      void messagesPulled(event.threadId).finally(() => liveRuns.remove(event.threadId, event.runId))
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
  let opened = false
  void fetchEventSource(`${serverBase()}/events`, {
    headers: { authorization: `Bearer ${sessionToken()}` },
    signal: ctrl.signal,
    openWhenHidden: true,
    async onopen(res) {
      if (!res.ok) throw new Error(`events: ${res.status}`)
      // Events sent while the connection was down are lost: reload what they'd have changed
      if (opened) {
        invalidate(["messages"])
        invalidate(keys.threads)
      }
      opened = true
    },
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
