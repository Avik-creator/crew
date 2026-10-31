import type { CachedTool, McpServer } from "@crew/db"

import { catalogBySlug } from "./catalog"

// auto: runs without asking. ask: asks, can be set to always allow.
// hard: always asks, never remembered. hidden: not offered to the model.
export type ToolDecision = "auto" | "ask" | "hard" | "hidden"

export type PolicyInput = {
  server: McpServer
  tool: CachedTool
  pref?: "always_allow" | "always_ask"
  // Nobody is watching (schedules, wakes): sending tools are left out
  background: boolean
}

// A rule returns a decision or passes. The first decision wins, so policies are
// composed by ordering rules, and callers can prepend their own.
export type ApprovalRule = (input: PolicyInput) => ToolDecision | undefined

const isHard = ({ server, tool }: PolicyInput) =>
  (server.hardApprovalTools ?? catalogBySlug(server.slug)?.hardApprovalTools ?? []).includes(tool.name)

export const hardRule: ApprovalRule = (i) => (isHard(i) ? (i.background ? "hidden" : "hard") : undefined)

export const preferenceRule: ApprovalRule = ({ pref }) =>
  pref === "always_allow" ? "auto" : pref === "always_ask" ? "ask" : undefined

export const serverDefaultsRule: ApprovalRule = ({ server, tool }) => {
  if (catalogBySlug(server.slug)?.autoTools?.includes(tool.name)) return "auto"
  if (server.defaultAskTools?.includes(tool.name)) return "ask"
  return undefined
}

export const readOnlyRule: ApprovalRule = ({ tool }) => (tool.annotations?.readOnlyHint === true ? "auto" : undefined)

export const askByDefault: ApprovalRule = () => "ask"

export const DEFAULT_RULES: ApprovalRule[] = [hardRule, preferenceRule, serverDefaultsRule, readOnlyRule, askByDefault]

export function decide(input: PolicyInput, rules: ApprovalRule[] = DEFAULT_RULES): ToolDecision {
  for (const rule of rules) {
    const d = rule(input)
    if (d) return d
  }
  return "ask"
}
