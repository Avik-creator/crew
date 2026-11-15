import { bots, bridges, db } from "@crew/db"
import { encrypt, randomToken } from "@crew/shared/node"
import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import { z } from "zod"

import { badRequest, notFound, requireUser, type AppEnv } from "../lib/http"
import { startBridge, stopBridge, telegram, TelegramError } from "../lib/telegram"
import { json } from "../lib/validate"

const linkCode = () => randomToken(8).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)

// Chat bridges. The token never leaves the server; the app sees the bot's
// username, the linked chat and the status.
export const bridgeRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const user = c.get("user")
    const [row] = await db.select().from(bridges).where(and(eq(bridges.userId, user.id), eq(bridges.kind, "telegram")))
    if (!row) return c.json({ telegram: null })
    return c.json({
      telegram: {
        botUsername: row.botUsername,
        linkCode: row.chatId ? null : row.linkCode,
        chatLabel: row.chatLabel,
        botId: row.botId,
        status: row.status,
        error: row.error,
      },
    })
  })
  // Saves a token from @BotFather and starts listening; the person then sends
  // "/start <code>" from their Telegram to link that chat
  .put("/telegram", json(z.object({ token: z.string().trim().regex(/^\d+:[\w-]{20,}$/, "That doesn't look like a bot token from @BotFather.") })), async (c) => {
    const user = c.get("user")
    const { token } = c.req.valid("json")
    const me = await telegram<{ username?: string }>(token, "getMe").catch((err) =>
      badRequest(err instanceof TelegramError && err.code === 401 ? "Telegram didn't accept that token." : "Couldn't reach Telegram. Try again."),
    )
    // Polling and webhooks can't both be on; clear any old webhook
    await telegram(token, "deleteWebhook", { drop_pending_updates: true }).catch(() => {})
    const values = {
      token: encrypt(token),
      botUsername: me.username ?? null,
      linkCode: linkCode(),
      chatId: null,
      chatLabel: null,
      lastUpdateId: null,
      status: "linking" as const,
      error: null,
    }
    const [row] = await db
      .insert(bridges)
      .values({ userId: user.id, kind: "telegram", ...values })
      .onConflictDoUpdate({ target: [bridges.userId, bridges.kind], set: values })
      .returning()
    startBridge(row!)
    return c.json({ botUsername: row!.botUsername, linkCode: row!.linkCode })
  })
  .patch("/telegram", json(z.object({ botId: z.string().nullable() })), async (c) => {
    const user = c.get("user")
    const { botId } = c.req.valid("json")
    if (botId) {
      const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), eq(bots.userId, user.id)))
      if (!bot) notFound("That bot")
    }
    const rows = await db
      .update(bridges)
      .set({ botId })
      .where(and(eq(bridges.userId, user.id), eq(bridges.kind, "telegram")))
      .returning({ id: bridges.id })
    if (!rows.length) notFound("Telegram")
    return c.json({ ok: true })
  })
  .delete("/telegram", async (c) => {
    const user = c.get("user")
    stopBridge(user.id)
    await db.delete(bridges).where(and(eq(bridges.userId, user.id), eq(bridges.kind, "telegram")))
    return c.body(null, 204)
  })
