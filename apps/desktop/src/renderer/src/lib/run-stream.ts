import { TRIGGER } from "@crew/shared"
import { useQuery } from "@tanstack/react-query"
import { useRealtimeStream } from "@trigger.dev/react-hooks"
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { useEffect, useState } from "react"

import { api } from "./api"

function asChunk(part: unknown): UIMessageChunk | null {
  if (!part || typeof part !== "object") return null
  const record = part as { type?: unknown; data?: unknown }
  if (typeof record.type === "string" && record.type !== "part") return part as UIMessageChunk
  if (record.data && typeof record.data === "object" && typeof (record.data as { type?: unknown }).type === "string") {
    return record.data as UIMessageChunk
  }
  return null
}

// The reply a bot is writing right now, rebuilt from the run's UI chunks.
// Chunks arrive through Trigger.dev realtime with a read-only token.
export function useLiveMessage(triggerRunId: string) {
  const token = useQuery({
    queryKey: ["run-token", triggerRunId],
    queryFn: () => api<{ token: string }>(`/runs/${triggerRunId}/token`),
    staleTime: 60 * 60_000,
  })
  const { parts } = useRealtimeStream<UIMessageChunk>(triggerRunId, TRIGGER.uiStream, {
    accessToken: token.data?.token,
    enabled: !!token.data,
    timeoutInSeconds: 600,
    baseURL: import.meta.env.RENDERER_VITE_TRIGGER_API_URL,
  })
  const [message, setMessage] = useState<UIMessage | null>(null)

  useEffect(() => {
    const chunks = (parts ?? []).map(asChunk).filter((c): c is UIMessageChunk => c != null)
    if (!chunks.length) return
    let cancelled = false
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    void (async () => {
      let latest: UIMessage | null = null
      try {
        for await (const next of readUIMessageStream({ stream })) latest = next
      } catch {
        // a bad chunk stops this replay; the next update tries again
      }
      if (!cancelled && latest) setMessage(latest)
    })()
    return () => {
      cancelled = true
    }
  }, [parts])

  return message
}
