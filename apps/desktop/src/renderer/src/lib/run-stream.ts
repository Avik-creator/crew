import { fetchEventSource } from "@microsoft/fetch-event-source"
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { useEffect, useState } from "react"

import { serverBase, sessionToken } from "./api"

// A response that retrying won't fix, like a run that isn't yours
class StreamClosed extends Error {}

// The reply a bot is writing right now, rebuilt from the run's UI chunks.
// The server streams them with their index as the event id, so a dropped
// connection resumes from the last chunk it got.
export function useLiveMessage(runId: string) {
  const [message, setMessage] = useState<UIMessage | null>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    let frame = 0
    let latest: UIMessage | null = null
    let feed: ReadableStreamDefaultController<UIMessageChunk> | undefined
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        feed = controller
      },
    })
    const close = () => {
      try {
        feed?.close()
      } catch {
        // already closed
      }
    }

    // One reader for the whole run. The screen updates at most once a frame
    // however fast the chunks come, and a bad chunk is skipped (onError).
    void (async () => {
      for await (const next of readUIMessageStream({ stream, onError: () => {} })) {
        latest = next
        frame ||= requestAnimationFrame(() => {
          frame = 0
          if (!ctrl.signal.aborted) setMessage(latest)
        })
      }
    })()

    void fetchEventSource(`${serverBase()}/runs/${runId}/stream`, {
      headers: { authorization: `Bearer ${sessionToken()}` },
      signal: ctrl.signal,
      openWhenHidden: true,
      async onopen(res) {
        if (!res.ok) throw new StreamClosed(`Live reply unavailable (${res.status})`)
      },
      onmessage(msg) {
        if (msg.event !== "chunk") return
        try {
          feed?.enqueue(JSON.parse(msg.data) as UIMessageChunk)
        } catch {
          // ignore a malformed chunk
        }
      },
      // The server ends the stream when the turn is done
      onclose: close,
      onerror(err) {
        if (err instanceof StreamClosed) throw err
        return 1000
      },
    }).catch(close)

    return () => {
      ctrl.abort()
      cancelAnimationFrame(frame)
      close()
    }
  }, [runId])

  return message
}
