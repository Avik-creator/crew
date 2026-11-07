import type { AppAction, AppSnapshotOptions } from "./device-protocol"

// agent-desktop (github.com/vercel-labs/agent-desktop) reads and operates apps
// on the Mac through the accessibility tree. One pinned release, checked by
// the sha256 of its release tarball. The cloud computer uses apps.py instead:
// agent-desktop crashes apps on its older accessibility libraries.
export const AGENT_DESKTOP = {
  version: "0.11.1",
  tarballs: {
    "darwin-arm64": {
      file: "agent-desktop-v0.11.1-aarch64-apple-darwin.tar.gz",
      sha256: "666671bd944fb88bf5b5668589f2bd653cd3a01942035260b454736879ff8779",
    },
    "darwin-x64": {
      file: "agent-desktop-v0.11.1-x86_64-apple-darwin.tar.gz",
      sha256: "32aedc30a787e8ec71ddec758128b30762a31a6ae9833099a5bc1288be302cf9",
    },
  },
} as const

export type AgentDesktopTarget = keyof typeof AGENT_DESKTOP.tarballs

export const agentDesktopUrl = (target: AgentDesktopTarget) =>
  `https://github.com/vercel-labs/agent-desktop/releases/download/v${AGENT_DESKTOP.version}/${AGENT_DESKTOP.tarballs[target].file}`

export function snapshotArgs({ app, root, skeleton, surface }: AppSnapshotOptions): string[] {
  const args = ["snapshot", "-i", "--compact"]
  if (root) args.push("--root", root)
  else args.push("--app", app)
  if (surface) args.push("--surface", surface)
  else if (skeleton && !root) args.push("--skeleton")
  return args
}

// The command for one action, with time for long text to be typed
export function actionArgs(action: AppAction): { args: string[]; timeoutMs: number } {
  switch (action.type) {
    case "type":
    case "set-value":
      return { args: [action.type, action.ref, action.text], timeoutMs: 30_000 + action.text.length * 40 }
    case "select":
      return { args: ["select", action.ref, action.option], timeoutMs: 30_000 }
    case "scroll":
      return { args: ["scroll", action.ref, "--direction", action.direction, "--amount", String(action.amount ?? 3)], timeoutMs: 30_000 }
    case "press":
      return { args: ["press", action.keys, ...(action.app ? ["--app", action.app] : [])], timeoutMs: 30_000 }
    default:
      return { args: [action.type, action.ref], timeoutMs: 30_000 }
  }
}

type Envelope = {
  ok: boolean
  data?: unknown
  error?: { code?: string; message?: string; suggestion?: string; disposition?: { retry?: string } }
}

// One command's printed envelope, as its data. An error keeps the code, the
// hint and whether a retry is safe, which is what the model needs to recover.
export function parseAgentDesktop(stdout: string): unknown {
  let envelope: Envelope
  try {
    envelope = JSON.parse(stdout.trim().split("\n").pop() || "") as Envelope
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
