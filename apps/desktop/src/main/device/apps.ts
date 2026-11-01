import { execFile } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import type { AppAction, AppSnapshotOptions } from "@crew/shared"

const run = promisify(execFile)

// agent-desktop (github.com/vercel-labs/agent-desktop) reads and operates apps
// through the accessibility tree. Crew doesn't bundle it: the person installs
// it (npm i -g agent-desktop), so they choose and update the version.
const CANDIDATES = [
  "/opt/homebrew/bin/agent-desktop",
  "/usr/local/bin/agent-desktop",
  join(homedir(), ".npm-global/bin/agent-desktop"),
  join(homedir(), ".local/bin/agent-desktop"),
  join(homedir(), ".bun/bin/agent-desktop"),
  join(homedir(), ".volta/bin/agent-desktop"),
]

const executable = (path: string) => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

let cached: { path: string | null; at: number } | null = null

// Apps started from the Dock get a short PATH, so ask a login shell too
export async function findAgentDesktop(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.path
  let path = process.env.AGENT_DESKTOP_PATH && executable(process.env.AGENT_DESKTOP_PATH) ? process.env.AGENT_DESKTOP_PATH : null
  path ??= CANDIDATES.find(executable) ?? null
  if (!path) {
    const found = await run("/bin/zsh", ["-lc", "command -v agent-desktop"], { timeout: 5000 }).catch(() => null)
    const line = found?.stdout.trim().split("\n").pop()
    path = line && executable(line) ? line : null
  }
  cached = { path, at: Date.now() }
  return path
}

type Envelope = {
  ok: boolean
  data?: unknown
  error?: { code?: string; message?: string; suggestion?: string; disposition?: { retry?: string }; details?: unknown }
}

// Runs one command and returns its data. An error keeps the code, the hint and
// whether a retry is safe, which is what the model needs to recover.
async function call(args: string[], timeoutMs = 30_000): Promise<unknown> {
  const bin = await findAgentDesktop()
  if (!bin) throw new Error("agent-desktop isn't installed on this Mac. Install it with: npm i -g agent-desktop")
  let stdout: string
  try {
    stdout = (await run(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch (err) {
    // Structured errors exit non-zero but still print the envelope
    stdout = (err as { stdout?: string }).stdout ?? ""
    if (!stdout.trim()) throw new Error(`agent-desktop failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  let envelope: Envelope
  try {
    envelope = JSON.parse(stdout) as Envelope
  } catch {
    throw new Error(`agent-desktop printed something unexpected: ${stdout.slice(0, 300)}`)
  }
  if (envelope.ok) return envelope.data
  const e = envelope.error ?? {}
  throw new Error(
    [
      `${e.code ?? "ERROR"}: ${e.message ?? "agent-desktop refused"}`,
      e.suggestion ? `Hint: ${e.suggestion}` : "",
      e.disposition?.retry ? `Retry: ${e.disposition.retry}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

export const apps = {
  listApps: () => call(["list-apps"]),

  snapshot({ app, root, skeleton, surface }: AppSnapshotOptions) {
    const args = ["snapshot", "-i", "--compact"]
    if (root) args.push("--root", root)
    else args.push("--app", app)
    if (surface) args.push("--surface", surface)
    else if (skeleton && !root) args.push("--skeleton")
    return call(args)
  },

  act(action: AppAction) {
    switch (action.type) {
      case "type":
      case "set-value":
        return call([action.type, action.ref, action.text], 30_000 + action.text.length * 40)
      case "select":
        return call(["select", action.ref, action.option])
      case "scroll":
        return call(["scroll", action.ref, "--direction", action.direction, "--amount", String(action.amount ?? 3)])
      case "press":
        return call(["press", action.keys, ...(action.app ? ["--app", action.app] : [])])
      default:
        return call([action.type, action.ref])
    }
  },
}
