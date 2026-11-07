import { db, deviceCommandRules } from "@crew/db"
import type { ToolApprovalStatus } from "ai"
import { eq } from "drizzle-orm"

type Rule = { pattern: string; mode: "always_allow" | "always_ask" | "deny" }

// "git status" matches exactly; "git *" matches "git" alone or "git" then
// whitespace and anything ("gitx" does not match)
export function matchesPattern(command: string, pattern: string) {
  const c = command.trim()
  const p = pattern.trim()
  if (!p.endsWith("*")) return c === p
  const prefix = p.slice(0, -1).trimEnd()
  if (!prefix) return true
  return c === prefix || (c.startsWith(prefix) && /\s/.test(c[prefix.length]))
}

// Deny keeps the old loose prefix test so a block rule never gets narrower
function matchesDeny(command: string, pattern: string) {
  const c = command.trim()
  const p = pattern.trim()
  return p.endsWith("*") ? c.startsWith(p.slice(0, -1)) : c === p
}

const SEPARATORS = /&&|\|\||;|\|/
// Quoting makes real parsing hard, so any character that could start another
// command, expand, or redirect (newline, backtick, $, lone &, < > ( ) { } \,
// NUL) means the person approves, whatever the allow rules say.
const METACHARS = /[\n\r`$<>(){}\\\0]|(?<!&)&(?!&)/
// Wider split used only to find denied commands hidden in $( ), backticks,
// subshells, redirections or extra lines
const DENY_SPLIT = /&&|\|\||;|\||&|[\n\r`$<>(){}\0]/

// Chained commands must each be allowed; one "deny" denies the whole line
export function commandDecision(command: string, rules: Rule[]): ToolApprovalStatus {
  const ask: ToolApprovalStatus = { type: "user-approval", reason: "Runs a command on your Mac" }
  const denyRules = rules.filter((r) => r.mode === "deny")
  const denyPieces = [...command.split(SEPARATORS), ...command.split(DENY_SPLIT)].map((s) => s.trim()).filter(Boolean)
  for (const piece of denyPieces) {
    if (denyRules.some((r) => matchesDeny(piece, r.pattern))) return { type: "denied", reason: `"${piece}" is blocked on this Mac` }
  }
  if (METACHARS.test(command)) return ask
  const pieces = command.split(SEPARATORS).map((s) => s.trim()).filter(Boolean)
  const allAllowed =
    pieces.length > 0 && pieces.every((piece) => rules.find((r) => r.mode !== "deny" && matchesPattern(piece, r.pattern))?.mode === "always_allow")
  return allAllowed ? "not-applicable" : ask
}

// A remembered command is saved as an exact rule. Commands ending in "*"
// would read as a prefix rule and commands with shell metacharacters can
// never be auto-allowed, so neither is remembered.
export function rememberableCommand(command: string) {
  const c = command.trim()
  return c && !c.endsWith("*") && !METACHARS.test(c) ? c : null
}

const DEVICE_WRITES = new Set(["writeFile"])

// Approvals for the bot's own tools. Cloud tools run freely (the cloud
// computer is a sandbox); on a Mac, commands and writes ask unless allowed.
// Mouse and keyboard control is guarded on the Mac itself by the overlay and
// the kill switch rather than per-action prompts.
export async function builtinApproval(opts: { runsOn: "cloud" | "device"; deviceId: string | null }) {
  if (opts.runsOn === "cloud" || !opts.deviceId) return () => undefined
  const rules = await db.select().from(deviceCommandRules).where(eq(deviceCommandRules.deviceId, opts.deviceId))
  return (toolName: string, input: unknown): ToolApprovalStatus => {
    if (toolName === "bash") return commandDecision(String((input as { command?: string }).command ?? ""), rules)
    if (DEVICE_WRITES.has(toolName)) return { type: "user-approval", reason: "Changes a file on your Mac" }
    return undefined
  }
}
