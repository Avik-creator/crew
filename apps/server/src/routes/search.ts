import { bots, db, messages, threads } from "@crew/db"
import { and, desc, eq, ilike, sql } from "drizzle-orm"
import { Hono } from "hono"

import { requireUser, type AppEnv } from "../lib/http"

// Postgres full-text search over messages (GIN index on to_tsvector(text)),
// plus bots and groups by name, for the command palette
export const searchRoutes = new Hono<AppEnv>().use(requireUser).get("/", async (c) => {
  const user = c.get("user")
  const q = (c.req.query("q") ?? "").trim().slice(0, 200)
  if (q.length < 2) return c.json({ messages: [], bots: [], threads: [] })
  const query = sql`websearch_to_tsquery('english', ${q})`
  const vector = sql`to_tsvector('english', ${messages.text})`
  const [found, botRows, threadRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        threadId: messages.threadId,
        authorType: messages.authorType,
        authorId: messages.authorId,
        createdAt: messages.createdAt,
        snippet: sql<string>`ts_headline('english', ${messages.text}, ${query}, 'MaxWords=24, MinWords=8, StartSel=<<, StopSel=>>')`,
        rank: sql<number>`ts_rank(${vector}, ${query})`,
      })
      .from(messages)
      .innerJoin(threads, eq(threads.id, messages.threadId))
      .where(and(eq(threads.userId, user.id), sql`${vector} @@ ${query}`))
      .orderBy(desc(sql`ts_rank(${vector}, ${query})`), desc(messages.createdAt))
      .limit(30),
    db
      .select({ id: bots.id, name: bots.name, job: bots.job, color: bots.color })
      .from(bots)
      .where(and(eq(bots.userId, user.id), ilike(bots.name, `%${q}%`)))
      .limit(10),
    db
      .select({ id: threads.id, name: threads.name, kind: threads.kind })
      .from(threads)
      .where(and(eq(threads.userId, user.id), ilike(threads.name, `%${q}%`)))
      .limit(10),
  ])
  return c.json({ messages: found, bots: botRows, threads: threadRows })
})
