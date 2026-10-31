import { TRIGGER } from "@crew/shared"
import { useQuery } from "@tanstack/react-query"
import { useRealtimeStream } from "@trigger.dev/react-hooks"
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { useEffect, useRef, useState } from "react"

import { api } from "./api"

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
  const feed = useRef<{ controller: ReadableStreamDefaultController<UIMessageChunk>; sent: number } | null>(null)

  useEffect(() => {
    let controller!: ReadableStreamDefaultController<UIMessageChunk>
    const stream = new ReadableStream<UIMessageChunk>({ start: (c) => (controller = c) })
    feed.current = { controller, sent: 0 }
    let cancelled = false
    void (async () => {
      try {
        for await (const m of readUIMessageStream({ stream })) if (!cancelled) setMessage(m)
      } catch {
        // stream ended or was malformed
      }
    })()
    return () => {
      cancelled = true
      try {
        controller.close()
      } catch {
        // already closed
      }
    }
  }, [triggerRunId])

  useEffect(() => {
    const f = feed.current
    if (!f || !parts) return
    for (; f.sent < parts.length; f.sent++) {
      try {
        f.controller.enqueue(parts[f.sent]!)
      } catch {
        return
      }
    }
  }, [parts])

  return message
}
