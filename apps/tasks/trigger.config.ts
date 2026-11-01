import { defineConfig } from "@trigger.dev/sdk"

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_crew",
  runtime: "node",
  dirs: ["./src/trigger"],
  // Screen work can take a while; a turn stops itself well before this
  maxDuration: 60 * 60,
  // Reuse a warm process between turns instead of booting one per message
  processKeepAlive: { enabled: true, maxExecutionsPerProcess: 50 },
  retries: {
    enabledInDev: false,
    // A turn is not idempotent (it may have sent an email); never replay it
    default: { maxAttempts: 1 },
  },
})
