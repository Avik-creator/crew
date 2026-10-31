import { createNeon } from "@neon/ai-sdk-provider"
import type { LanguageModel } from "ai"

// All model calls go through the Neon AI Gateway. Swapping providers means
// changing this file only; everything else takes a LanguageModel.
let neon: ReturnType<typeof createNeon> | undefined

export const DEFAULT_MODEL = () => process.env.DEFAULT_MODEL || "claude-sonnet-5-5"
export const ROUTER_MODEL = () => process.env.ROUTER_MODEL || "claude-haiku-5-5"

export function languageModel(id?: string | null): LanguageModel {
  neon ??= createNeon({
    baseURL: process.env.NEON_AI_GATEWAY_BASE_URL,
    apiKey: process.env.NEON_AI_GATEWAY_TOKEN,
  })
  return neon(id || DEFAULT_MODEL())
}
