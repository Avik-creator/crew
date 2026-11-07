// Pushed to the desktop app over one SSE stream per user, so it can refresh
// what changed without polling. Payloads stay small: the app refetches details.
export type AppEvent =
  // cleared: its messages are gone, so the app drops what it has of them
  | { type: "thread.updated"; threadId: string; cleared?: boolean }
  // Bots or groups were added, changed or removed (e.g. by the chief)
  | { type: "team.updated" }
  // Also sent when a saved message changes, e.g. a reply that continues after an approval
  | { type: "message.created"; threadId: string; messageId: string; botId?: string | null }
  | {
      type: "run.started"
      threadId: string
      runId: string
      botId: string
    }
  | {
      type: "run.finished"
      threadId: string
      runId: string
      botId: string
      status: "completed" | "failed" | "cancelled"
    }
  | { type: "approval.requested"; approvalId: string; threadId: string | null; botId: string }
  | { type: "approval.resolved"; approvalId: string }
  | { type: "takeover.requested"; takeoverId: string; threadId: string | null; botId: string }
  | { type: "takeover.resolved"; takeoverId: string }
  | { type: "computer.status"; status: string }
  | { type: "device.status"; deviceId: string; status: "online" | "offline" }
  | { type: "connection.updated"; connectionId: string; status: string }
  | { type: "notify"; title: string; body: string; threadId?: string | null }
