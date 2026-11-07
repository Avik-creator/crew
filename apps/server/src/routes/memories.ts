import { db, memories } from "@crew/db"
import { json } from "../lib/validate"
import { and, desc, eq, isNull } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { notFound, requireUser, type AppEnv } from "../lib/http"
import { ownBot } from "./bots"

const memorySchema = z.object({
  key: z.string().trim().min(1).max(80),
  content: z.string().trim().min(1).max(2000),
  category: z.enum(["preference", "person", "project", "process", "general"]).default("general"),
  // null = shared with every bot
  botId: z.string().nullable(),
})

export const memoryRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const botId = c.req.query("botId")
    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, user.id),
          botId === "shared" ? isNull(memories.botId) : botId ? eq(memories.botId, botId) : undefined,
        ),
      )
      .orderBy(desc(memories.updatedAt))
    return c.json(rows)
  })
  .post("/", json(memorySchema), async (c) => {
    const user = c.get("user")
    const input = c.req.valid("json")
    if (input.botId) await ownBot(user.id, input.botId)
    const [row] = await db.insert(memories).values({ ...input, userId: user.id }).returning()
    return c.json(row, 201)
  })
  .patch("/:id", json(memorySchema.partial()), async (c) => {
    const user = c.get("user")
    const input = c.req.valid("json")
    if (input.botId) await ownBot(user.id, input.botId)
    const [row] = await db
      .update(memories)
      .set(input)
      .where(and(eq(memories.id, c.req.param("id")), eq(memories.userId, user.id)))
      .returning()
    return row ? c.json(row) : notFound("That memory")
  })
  .delete("/:id", async (c) => {
    const user = c.get("user")
    await db.delete(memories).where(and(eq(memories.id, c.req.param("id")), eq(memories.userId, user.id)))
    return c.body(null, 204)
  })
