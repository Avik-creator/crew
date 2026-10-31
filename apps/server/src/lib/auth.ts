import { account, db, session, user, userSettings, verification } from "@crew/db"
import { DEEP_LINK_SCHEME } from "@crew/shared"
import { serverUrl } from "@crew/shared/node"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { bearer } from "better-auth/plugins"

// Private app: when ALLOWED_EMAILS is set, only those people can sign up
const allowed = () =>
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

export const auth = betterAuth({
  baseURL: serverUrl(),
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: { enabled: true, autoSignIn: true, minPasswordLength: 8 },
  // The desktop app keeps the session token in the OS keychain and sends it as a bearer
  plugins: [bearer()],
  trustedOrigins: [`${DEEP_LINK_SCHEME}://`, "http://localhost:5173"],
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          const list = allowed()
          if (list.length && !list.includes(u.email.toLowerCase())) {
            throw new APIError("FORBIDDEN", { message: "This Crew is private. Ask the owner to add your email." })
          }
          return { data: u }
        },
        after: async (u) => {
          await db.insert(userSettings).values({ userId: u.id }).onConflictDoNothing()
        },
      },
    },
  },
})

export type AuthUser = typeof auth.$Infer.Session.user
