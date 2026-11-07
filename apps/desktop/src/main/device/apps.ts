import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { accessSync, constants } from "node:fs"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

import { actionArgs, AGENT_DESKTOP, agentDesktopUrl, parseAgentDesktop, snapshotArgs, type AgentDesktopTarget } from "@crew/shared"
import type { AppAction, AppSnapshotOptions } from "@crew/shared"
import { app } from "electron"

const run = promisify(execFile)

// agent-desktop (github.com/vercel-labs/agent-desktop) reads and operates apps
// through the accessibility tree. Crew downloads the pinned release itself,
// checks it against its sha256 and keeps it in the app's data folder.
// AGENT_DESKTOP_PATH points at another build instead.
const target: AgentDesktopTarget = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"
const installDir = () => join(app.getPath("userData"), `agent-desktop-${AGENT_DESKTOP.version}`)
const installed = () => join(installDir(), "agent-desktop")

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function findAgentDesktop(): Promise<string | null> {
  const override = process.env.AGENT_DESKTOP_PATH
  if (override && executable(override)) return override
  return executable(installed()) ? installed() : null
}

let installing: Promise<string> | undefined

// Downloads and unpacks the pinned release once; later calls find it
export function installAgentDesktop(): Promise<string> {
  installing ??= (async () => {
    const found = await findAgentDesktop()
    if (found) return found
    if (process.platform !== "darwin") throw new Error("App control is set up on macOS only")
    const res = await fetch(agentDesktopUrl(target), { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`agent-desktop didn't download (${res.status})`)
    const tarball = Buffer.from(await res.arrayBuffer())
    if (createHash("sha256").update(tarball).digest("hex") !== AGENT_DESKTOP.tarballs[target].sha256) {
      throw new Error("The agent-desktop download didn't match its checksum, so it wasn't installed")
    }
    // Unpacked next to the final folder and moved in whole, so a half-written copy is never used
    const staging = `${installDir()}.partial`
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await writeFile(join(staging, "agent-desktop.tar.gz"), tarball)
    await run("/usr/bin/tar", ["-xzf", "agent-desktop.tar.gz"], { cwd: staging })
    await rm(join(staging, "agent-desktop.tar.gz"))
    if (!executable(join(staging, "agent-desktop"))) throw new Error("The agent-desktop download had no program in it")
    await rm(installDir(), { recursive: true, force: true })
    await rename(staging, installDir())
    return installed()
  })().finally(() => (installing = undefined))
  return installing
}

// Runs one command and returns its data, or throws with the code and hint
async function call(args: string[], timeoutMs = 30_000): Promise<unknown> {
  const bin = await findAgentDesktop()
  if (!bin) throw new Error("App control isn't set up on this Mac yet. Open Crew's Settings → This Mac to finish it.")
  let stdout: string
  try {
    stdout = (await run(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch (err) {
    // Structured errors exit non-zero but still print the envelope
    stdout = (err as { stdout?: string }).stdout ?? ""
    if (!stdout.trim()) throw new Error(`agent-desktop failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  return parseAgentDesktop(stdout)
}

export const apps = {
  listApps: () => call(["list-apps"]),
  snapshot: (opts: AppSnapshotOptions) => call(snapshotArgs(opts)),
  act(action: AppAction) {
    const { args, timeoutMs } = actionArgs(action)
    return call(args, timeoutMs)
  },
}
