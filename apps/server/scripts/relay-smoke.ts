// Checks the device relay end to end with a fake device:
// SERVER=http://localhost:8787 SESSION=<bearer> INTERNAL_API_SECRET=... tsx scripts/relay-smoke.ts
import WebSocket from "ws"

const server = process.env.SERVER ?? "http://localhost:8787"
const session = process.env.SESSION!
const internal = process.env.INTERNAL_API_SECRET!
const auth = { authorization: `Bearer ${session}`, "content-type": "application/json" }

const created = await fetch(`${server}/devices`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ name: "Relay smoke", platform: "darwin" }),
}).then((r) => r.json() as Promise<{ device: { id: string }; token: string }>)

// Collect app events while the device comes online
const events: string[] = []
const sse = await fetch(`${server}/events`, { headers: auth })
void (async () => {
  const reader = sse.body!.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    for (const line of new TextDecoder().decode(value).split("\n")) if (line.startsWith("data: {\"type")) events.push(line.slice(6))
  }
})()

const ws = new WebSocket(`${server.replace(/^http/, "ws")}/devices/connect`, {
  headers: { authorization: `Bearer ${created.token}` },
})
await new Promise((r) => ws.once("open", r))
ws.send(JSON.stringify({ type: "hello", appVersion: "0.0.0", platform: "darwin", allowedPaths: [], capabilities: { shell: true, files: true, screen: false, input: false, stdioMcp: true } }))
ws.on("message", (raw) => {
  const frame = JSON.parse(String(raw))
  if (frame.type === "invoke") {
    ws.send(JSON.stringify({ type: "result", id: frame.id, ok: true, output: { exitCode: 0, stdout: `ran: ${frame.input.command}`, stderr: "" } }))
  }
})
await new Promise((r) => setTimeout(r, 300))

const invoke = await fetch(`${server}/internal/devices/${created.device.id}/invoke`, {
  method: "POST",
  headers: { authorization: `Bearer ${internal}`, "content-type": "application/json" },
  body: JSON.stringify({ runId: "r1", botId: "b1", botName: "Smoke", tool: "bash", input: { command: "echo hi" }, background: false }),
}).then((r) => r.json())

const list = await fetch(`${server}/devices`, { headers: auth }).then((r) => r.json() as Promise<{ id: string; online: boolean }[]>)
ws.close()
await new Promise((r) => setTimeout(r, 300))
await fetch(`${server}/devices/${created.device.id}`, { method: "DELETE", headers: auth })

console.log(JSON.stringify({
  invoke,
  onlineInList: list.find((d) => d.id === created.device.id)?.online,
  events,
}, null, 2))
process.exit(0)
