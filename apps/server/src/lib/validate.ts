import { zValidator } from "@hono/zod-validator"
import type { ZodType } from "zod"

// JSON body validation that answers with the first readable message
export const json = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0]
      const field = issue?.path.join(".")
      const message = issue?.message.startsWith("Invalid input") && field ? `Check ${field}: ${issue.message}` : issue?.message
      return c.json({ error: message ?? "Invalid request" }, 400)
    }
  })
