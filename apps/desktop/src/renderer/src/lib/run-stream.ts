import { TRIGGER } from "@crew/shared"
import { useQuery } from "@tanstack/react-query"
import { useRealtimeStream } from "@trigger.dev/react-hooks"
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { useEffect, useRef, useState } from "react"

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
  const feed = useRef<{ controller: ReadableStreamDefaultController<UIMessageChunk>; seen: number } | null>(null)

  // One reader for the whole run. Each chunk is applied once, and the screen
  // updates at most once a frame however fast the chunks come.
  useEffect(() => {
    let frame = 0
    let latest: UIMessage | null = null
    let closed = false
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        feed.current = { controller, seen: 0 }
      },
    })
    void (async () => {
      // A bad chunk is skipped (onError), the rest still render
      for await (const next of readUIMessageStream({ stream, onError: () => {} })) {
        latest = next
        frame ||= requestAnimationFrame(() => {
          frame = 0
          if (!closed) setMessage(latest)
        })
      }
    })()
    return () => {
      closed = true
      cancelAnimationFrame(frame)
      try {
        feed.current?.controller.close()
      } catch {
        // already closed
      }
      feed.current = null
    }
  }, [triggerRunId])

  // Hand the reader only the chunks it hasn't seen
  useEffect(() => {
    const f = feed.current
    if (!f || !parts) return
    for (; f.seen < parts.length; f.seen++) {
      const chunk = asChunk(parts[f.seen])
      if (chunk) f.controller.enqueue(chunk)
    }
  }, [parts])

  return message
}
