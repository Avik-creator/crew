import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"

import * as schema from "./schema"

export * from "./schema"
export { schema }

export type DB = NodePgDatabase<typeof schema>

declare global {
  var __crewDb: { pool: pg.Pool; db: DB } | undefined
}

function connect() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error("DATABASE_URL is not set")
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    // Neon closes idle connections; drop ours first
    idleTimeoutMillis: 30_000,
  })
  return { pool, db: drizzle(pool, { schema }) }
}

// Connect on first use, not at import, so scripts can load env first
function instance() {
  return (globalThis.__crewDb ??= connect())
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = instance().db
    const value = Reflect.get(real, prop, real)
    return typeof value === "function" ? value.bind(real) : value
  },
})

export function getPool() {
  return instance().pool
}
