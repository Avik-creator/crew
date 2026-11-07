import { startScheduleClock } from "@crew/agent"
import { maintainComputers, onComputerStatus, setDeviceInvoker } from "@crew/computer"
import { seedCatalog } from "@crew/mcp"
import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"

import { app } from "./app"
import { publish } from "./lib/bus"
import { relay } from "./lib/relay"
import { runner } from "./lib/runner"

const port = Number(process.env.PORT ?? 8787)

await seedCatalog().catch((err) => console.error("Couldn't seed connectors:", err))
onComputerStatus((userId, status) => publish(userId, { type: "computer.status", status }))
setDeviceInvoker((deviceId, req) => relay.invoke(deviceId, req))

runner.start()
startScheduleClock(runner)
// Keeps computer status honest and cycles long-running sandboxes
setInterval(() => void maintainComputers().catch((err) => console.error("Computer check failed:", err)), 10 * 60_000)

serve({ fetch: app.fetch, port, websocket: { server: new WebSocketServer({ noServer: true }) } }, (info) => {
  console.log(`Crew server on http://localhost:${info.port}`)
})

// Turns running here end with a note instead of hanging until their claim lapses
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runner
      .stop()
      .catch((err) => console.error("Couldn't stop turns cleanly:", err))
      .finally(() => process.exit(0))
  })
}
