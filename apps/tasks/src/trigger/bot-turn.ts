import { httpEvents, runTurn, triggerDispatcher } from "@crew/agent"
import { TRIGGER, type TurnPayload } from "@crew/shared"
import { logger, task } from "@trigger.dev/sdk"

import { uiStream } from "./streams"

// Every bot turn runs here, one per bot at a time (concurrencyKey = botId)
export const botTurn = task({
  id: TRIGGER.botTurn,
  concurrency: { perKey: 1 },
  run: async (payload: TurnPayload, { ctx, signal }) => {
    const result = await runTurn(payload, {
      dispatcher: triggerDispatcher,
      events: httpEvents,
      triggerRunId: ctx.run.id,
      signal,
      pipe: async (stream) => {
        const { waitUntilComplete } = uiStream.pipe(stream)
        await waitUntilComplete()
      },
    })
    if (result.status === "skipped") logger.info("Turn skipped", { reason: result.reason })
    if (result.status === "failed") logger.error("Turn failed", { reason: result.reason })
    return result
  },
})
