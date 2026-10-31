import { onComputerStatus } from "@crew/computer"
import { seedCatalog } from "@crew/mcp"
import { serve } from "@hono/node-server"
import { WebSocketServer } from "ws"

import { app } from "./app"
import { publish } from "./lib/bus"

const port = Number(process.env.PORT ?? 8787)

await seedCatalog().catch((err) => console.error("Couldn't seed connectors:", err))
onComputerStatus((userId, status) => publish(userId, { type: "computer.status", status }))

serve({ fetch: app.fetch, port, websocket: { server: new WebSocketServer({ noServer: true }) } }, (info) => {
  console.log(`Crew server on http://localhost:${info.port}`)
})
