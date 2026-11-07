import { spawn, type ChildProcess } from "node:child_process"
import { homedir } from "node:os"

import { expandHome } from "./paths"

const OUTPUT_CAP = 200_000
const KILL_GRACE_MS = 2_000

// Ends a command and everything it started: the shell leads its own process
// group, so background jobs and pipelines go with it
export function killTree(child: ChildProcess) {
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, sig)
    } catch {
      // Already gone
    }
  }
  if (!child.pid) return
  signal("SIGTERM")
  setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref()
}

export function bash(command: string, timeoutMs = 120_000, cwd?: string, onSpawn?: (child: ChildProcess) => () => void) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", command], { cwd: cwd ? expandHome(cwd) : homedir(), detached: true })
    const forget = onSpawn?.(child)
    const timer = setTimeout(() => killTree(child), timeoutMs)
    let stdout = ""
    let stderr = ""
    const done = (result: { exitCode: number; stdout: string; stderr: string }) => {
      clearTimeout(timer)
      forget?.()
      resolve(result)
    }
    child.stdout.on("data", (d) => (stdout = (stdout + d).slice(-OUTPUT_CAP)))
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-OUTPUT_CAP)))
    child.on("close", (code, signal) =>
      done({ exitCode: code ?? (signal ? 124 : -1), stdout, stderr: signal ? `${stderr}\n(stopped: ${signal})` : stderr }),
    )
    child.on("error", (err) => done({ exitCode: -1, stdout, stderr: err.message }))
  })
}
