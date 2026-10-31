import { maintainComputers } from "@crew/computer"
import { logger, schedules } from "@trigger.dev/sdk"

// Keeps computer status honest and cycles long-running sandboxes
export const computerMaintenance = schedules.task({
  id: "computer-maintenance",
  cron: "*/10 * * * *",
  run: async () => {
    const result = await maintainComputers()
    logger.info("Computers checked", result)
    return result
  },
})
