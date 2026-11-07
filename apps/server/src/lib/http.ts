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

export function notFound(what = "That"): never {
  throw new HTTPException(404, { message: `${what} wasn't found.` })
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message })
}
