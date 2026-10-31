import { db, deviceCommandRules } from "@crew/db"
import type { ToolApprovalStatus } from "ai"
import { eq } from "drizzle-orm"

type Rule = { pattern: string; mode: "always_allow" | "always_ask" | "deny" }

// "git status" matches exactly; "git *" matches anything starting with "git "
export function matchesPattern(command: string, pattern: string) {
  const c = command.trim()
  const p = pattern.trim()
  return p.endsWith("*") ? c.startsWith(p.slice(0, -1)) : c === p
}

// Chained commands must each be allowed; one "deny" denies the whole line
export function commandDecision(command: string, rules: Rule[]): ToolApprovalStatus {
  const pieces = command.split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean)
  let allAllowed = pieces.length > 0
  for (const piece of pieces) {
    const rule = rules.find((r) => matchesPattern(piece, r.pattern))
    if (rule?.mode === "deny") return { type: "denied", reason: `"${piece}" is blocked on this Mac` }
    if (rule?.mode !== "always_allow") allAllowed = false
  }
  return allAllowed ? "not-applicable" : { type: "user-approval", reason: "Runs a command on your Mac" }
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
