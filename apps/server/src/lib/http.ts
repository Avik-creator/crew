import { safeEqual } from "@crew/shared/node"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"

import { auth, type AuthUser } from "./auth"

export type AppEnv = { Variables: { user: AuthUser } }

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const result = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!result) throw new HTTPException(401, { message: "Sign in to continue." })
  c.set("user", result.user)
  await next()
})

// Calls from Trigger tasks: a shared secret, never exposed to the app
export const requireInternal = createMiddleware(async (c, next) => {
  const secret = process.env.INTERNAL_API_SECRET
  const header = c.req.header("authorization")?.replace(/^Bearer /, "") ?? ""
  if (!secret || !safeEqual(header, secret)) throw new HTTPException(401, { message: "Unauthorized" })
  await next()
})

export function notFound(what = "That"): never {
  throw new HTTPException(404, { message: `${what} wasn't found.` })
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message })
}
