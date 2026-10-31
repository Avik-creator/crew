import type { AppEvent, LocalToolName } from "@crew/shared"
import { Hono } from "hono"

import { publish } from "../lib/bus"
import { requireInternal } from "../lib/http"
import { relay } from "../lib/relay"

// Routes only Trigger tasks call, guarded by INTERNAL_API_SECRET
export const internalRoutes = new Hono()
  .use(requireInternal)
  .post("/events", async (c) => {
    const { userId, event } = await c.req.json<{ userId: string; event: AppEvent }>()
    publish(userId, event)
    return c.json({ ok: true })
  })
  .post("/devices/:id/invoke", async (c) => {
    const body = await c.req.json<{
      runId: string
      botId: string
      botName: string
      tool: LocalToolName
      input: Record<string, unknown>
      background: boolean
    }>()
    try {
      const output = await relay.invoke(c.req.param("id"), body)
      return c.json({ ok: true, output })
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
