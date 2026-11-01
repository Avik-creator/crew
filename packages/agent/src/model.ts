import { createNeon } from "@neon/ai-sdk-provider"
import type { LanguageModel } from "ai"

// All model calls go through the Neon AI Gateway. Swapping providers means
// changing this file only; everything else takes a LanguageModel.
let neon: ReturnType<typeof createNeon> | undefined

export const DEFAULT_MODEL = () => process.env.DEFAULT_MODEL || "gpt-5-4-nano"
export const ROUTER_MODEL = () => process.env.ROUTER_MODEL || "claude-haiku-5-5"

export function languageModel(id?: string | null): LanguageModel {
  neon ??= createNeon({
    baseURL: process.env.NEON_AI_GATEWAY_BASE_URL,
    apiKey: process.env.NEON_AI_GATEWAY_TOKEN,
  })
  // Claude's adapter drops image file-data inside tool results. image-data is shown.
  return withToolImages(neon(id || DEFAULT_MODEL()))
}

type ContentPart = {
  type?: string
  mediaType?: string
  data?: unknown
  output?: { type?: string; value?: ContentPart[] }
}

// The AI SDK turns a tool image into file-data before this v3 model sees it.
function withToolImages<T extends object>(model: T): T {
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop !== "doGenerate" && prop !== "doStream") return Reflect.get(target, prop, receiver)
      const method = Reflect.get(target, prop, receiver) as (options: { prompt: unknown }) => unknown
      return (options: { prompt: unknown }) => method.call(target, { ...options, prompt: rewriteToolImages(options.prompt) })
    },
  })
}

function rewriteToolImages(prompt: unknown): unknown {
  if (!Array.isArray(prompt)) return prompt
  return prompt.map((message) => {
    if (!message || typeof message !== "object" || message.role !== "tool" || !Array.isArray(message.content)) return message
    return {
      ...message,
      content: message.content.map((part: ContentPart) => {
        if (part?.type !== "tool-result" || part.output?.type !== "content" || !Array.isArray(part.output.value)) return part
        return {
          ...part,
          output: {
            ...part.output,
            value: part.output.value.map((item) =>
              item?.type === "file-data" && typeof item.mediaType === "string" && item.mediaType.startsWith("image/") && typeof item.data === "string"
                ? { type: "image-data", mediaType: item.mediaType === "image/*" ? "image/jpeg" : item.mediaType, data: item.data }
                : item,
            ),
          },
        }
      }),
    }
  })
}
