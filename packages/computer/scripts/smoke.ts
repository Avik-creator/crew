// Live check of the computer layer against the real provider, without the DB:
// pnpm --filter @crew/computer smoke
import { CloudDisplayDriver } from "../src/display"
import { getProvider } from "../src/providers"
import { Workstation } from "../src/workstation"

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const provider = getProvider()
const created = await provider.create({ userId: "smoke", resolution: [1280, 800], idleMs: 10 * 60_000 })
log("created", created)
const results: Record<string, unknown> = {}

try {
  let handle = await provider.connect(created.sandboxId, 10 * 60_000)
  let ws = new Workstation(handle)
  let t = Date.now()
  await ws.bootstrap()
  results.bootstrapMs = Date.now() - t

  t = Date.now()
  const { webPort } = await ws.ensureDisplay(1, "smokepw1")
  await ws.ensureDisplay(2, "smokepw2")
  results.displaysMs = Date.now() - t
  results.status1 = await ws.supervisor.status("display-1")

  const d1 = new CloudDisplayDriver(handle, 1)
  const d2 = new CloudDisplayDriver(handle, 2)
  await d2.bash("nohup xfce4-terminal >/dev/null 2>&1 &")
  t = Date.now()
  const shot = await d1.act({ type: "click", x: 300, y: 300 })
  results.actMs = Date.now() - t
  results.shotBytes = Buffer.from(shot.base64, "base64").length
  const shot2 = await d2.act({ type: "type", text: "echo hi from display 2" })
  results.shot2Bytes = Buffer.from(shot2.base64, "base64").length

  const ep = await handle.portEndpoint(webPort)
  results.novncNoToken = (await fetch(`${ep.url}/vnc.html`)).status
  results.novncWithToken = (await fetch(`${ep.url}/vnc.html`, { headers: ep.headers })).status

  // Idempotent ensure is a no-op
  t = Date.now()
  await ws.ensureDisplay(1, "smokepw1")
  results.ensureAgainMs = Date.now() - t

  await provider.pause(created.sandboxId)
  t = Date.now()
  handle = await provider.connect(created.sandboxId, 10 * 60_000)
  results.resumeMs = Date.now() - t
  ws = new Workstation(handle)
  results.statusAfterResume = await ws.supervisor.status("display-2")
  const shot3 = await new CloudDisplayDriver(handle, 2).screenshot()
  results.shotAfterResume = shot3.base64.length > 1000
} catch (err) {
  results.error = err instanceof Error ? err.stack : String(err)
} finally {
  console.log("RESULTS", JSON.stringify(results, null, 2))
  await provider.destroy(created.sandboxId).catch(() => {})
}
