import { directThread, ensureChief } from "@crew/agent"
import { approvals, bots, bridges, db, messages, runs, takeovers, threads, type Bridge } from "@crew/db"
import type { AppEvent } from "@crew/shared"
import { decrypt } from "@crew/shared/node"
import { and, eq, ne } from "drizzle-orm"

import { decideApproval } from "./approvals"
import { publish, tap } from "./bus"
import { postUserMessage } from "./messages"

// Telegram bridge: the person messages their bots from Telegram, gets the
// replies back, and allows or denies requests with buttons. It reads updates
// by long polling, so it works on a laptop with no public URL. Only the one
// chat linked with the code from Settings is ever answered.

const API = "https://api.telegram.org"
const POLL_SECONDS = 25
const MAX_TEXT = 4000
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

// Telegram's Bot API. The token is part of the URL, so errors are rebuilt
// from Telegram's own description and never carry the request.
export async function telegram<T>(token: string, method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new TelegramError("Couldn't reach Telegram.")
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string; error_code?: number }
  if (!data.ok) throw new TelegramError(data.description ?? `Telegram answered ${res.status}`, data.error_code ?? res.status)
  return data.result as T
}

type TgUser = { id: number; username?: string; first_name?: string }
type TgMessage = {
  message_id: number
  chat: { id: number; type: string; username?: string; first_name?: string }
  from?: TgUser
  text?: string
  caption?: string
  photo?: { file_id: string; file_size?: number }[]
}
type TgUpdate = {
  update_id: number
  message?: TgMessage
  callback_query?: { id: string; data?: string; message?: TgMessage }
}

const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase()

function chunks(text: string) {
  const out: string[] = []
  for (let rest = text; rest.length; ) {
    let cut = rest.length <= MAX_TEXT ? rest.length : rest.lastIndexOf("\n", MAX_TEXT)
    if (cut < MAX_TEXT / 2) cut = Math.min(rest.length, MAX_TEXT)
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, "")
  }
  return out
}

// ── Linked bridges, kept in memory so events don't each hit the database ──

type Live = { id: string; userId: string; token: string; chatId: string | null; abort: AbortController }
const live = new Map<string, Live>() // by user id

async function send(b: Pick<Live, "token" | "chatId">, text: string, extra: Record<string, unknown> = {}) {
  if (!b.chatId) return
  const parts = chunks(text)
  for (const [i, part] of parts.entries()) {
    await telegram(b.token, "sendMessage", { chat_id: b.chatId, text: part, ...(i === parts.length - 1 ? extra : {}) })
  }
}

async function setStatus(id: string, values: Partial<Pick<Bridge, "status" | "error" | "chatId" | "chatLabel" | "linkCode" | "lastUpdateId">>) {
  await db.update(bridges).set(values).where(eq(bridges.id, id))
}

// ── Incoming: messages and button presses ──

async function botsOf(userId: string) {
  return db.select().from(bots).where(and(eq(bots.userId, userId), ne(bots.status, "hidden")))
}

async function photoOf(token: string, msg: TgMessage) {
  const photo = msg.photo?.at(-1)
  if (!photo || (photo.file_size ?? 0) > MAX_PHOTO_BYTES) return []
  const file = await telegram<{ file_path?: string; file_size?: number }>(token, "getFile", { file_id: photo.file_id })
  if (!file.file_path || (file.file_size ?? 0) > MAX_PHOTO_BYTES) return []
  const res = await fetch(`${API}/file/bot${token}/${file.file_path}`).catch(() => null)
  if (!res?.ok) return []
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > MAX_PHOTO_BYTES) return []
  return [{ mediaType: "image/jpeg", base64: bytes.toString("base64") }]
}

const HELP = [
  "Message me and your bot answers here.",
  "• @Name your message: ask a specific bot",
  "• /bots: see your bots",
  "• /use Name: change who answers by default",
  "Requests that need your OK show up here with Allow and Deny buttons.",
].join("\n")

async function onMessage(b: Live, row: Bridge, msg: TgMessage) {
  if (msg.chat.type !== "private") return
  const chatId = String(msg.chat.id)
  const text = (msg.text ?? msg.caption ?? "").trim()

  // Linking: the code shown in Crew's settings, sent from the chat to link
  if (!row.chatId) {
    const code = text.match(/^\/start\s+(\S+)/)?.[1]
    if (code && row.linkCode && code === row.linkCode) {
      const label = msg.chat.username ? `@${msg.chat.username}` : (msg.chat.first_name ?? "Telegram")
      await setStatus(row.id, { chatId, chatLabel: label, linkCode: null, status: "active", error: null })
      b.chatId = chatId
      publish(b.userId, { type: "bridge.updated" })
      await send(b, `Linked to Crew. ${HELP}`)
    } else {
      await telegram(b.token, "sendMessage", { chat_id: chatId, text: "Open Crew → Settings → Telegram and send the link code shown there." })
    }
    return
  }
  if (chatId !== row.chatId) return // someone else found the bot

  const team = await botsOf(b.userId)
  if (text === "/start" || text === "/help") return send(b, HELP)
  if (text === "/bots") {
    const current = row.botId ?? team.find((x) => x.role === "chief")?.id
    return send(b, team.map((x) => `${x.id === current ? "→ " : "• "}${x.name}: ${x.job}${x.status === "paused" ? " (paused)" : ""}`).join("\n") || "No bots yet.")
  }
  const use = text.match(/^\/use\s+(.+)$/)?.[1]
  if (use) {
    const pick = team.find((x) => norm(x.name) === norm(use))
    if (!pick) return send(b, `There's no bot called ${use}. Send /bots to see them.`)
    await db.update(bridges).set({ botId: pick.id }).where(eq(bridges.id, row.id))
    return send(b, `${pick.name} answers here now.`)
  }

  // "@Name ..." picks the bot for this message; otherwise the default one
  let body = text
  let bot = undefined as (typeof team)[number] | undefined
  const mention = text.match(/^@(\S+)\s*([\s\S]*)$/)
  if (mention) {
    bot = team.find((x) => norm(x.name) === norm(mention[1]!))
    if (bot) body = mention[2]!.trim()
  }
  bot ??= team.find((x) => x.id === row.botId) ?? (await ensureChief(b.userId))
  if (!bot) return send(b, "Pick who answers here with /use Name.")
  if (bot.status !== "active") return send(b, `${bot.name} is ${bot.status} right now.`)

  const images = await photoOf(b.token, msg).catch(() => [])
  if (!body && !images.length) return
  const threadId = await directThread(b.userId, bot.id)
  const [thread] = await db.select().from(threads).where(eq(threads.id, threadId))
  await telegram(b.token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {})
  await postUserMessage(b.userId, thread!, { text: body || "(photo)", images }, { via: "telegram" })
}

async function onButton(b: Live, row: Bridge, q: NonNullable<TgUpdate["callback_query"]>) {
  const answer = (text: string) => telegram(b.token, "answerCallbackQuery", { callback_query_id: q.id, text }).catch(() => {})
  if (!row.chatId || String(q.message?.chat.id) !== row.chatId) return answer("Not allowed.")
  const m = q.data?.match(/^ap:([\w-]+):([01])$/)
  if (!m) return answer("")
  const approved = m[2] === "1"
  try {
    await decideApproval(b.userId, m[1]!, { approved })
  } catch (err) {
    return answer(err instanceof Error ? err.message : "Couldn't do that.")
  }
  await answer(approved ? "Allowed" : "Denied")
  if (q.message) {
    await telegram(b.token, "editMessageText", {
      chat_id: row.chatId,
      message_id: q.message.message_id,
      text: `${q.message.text ?? ""}\n\n${approved ? "✅ Allowed" : "❌ Denied"}`,
    }).catch(() => {})
  }
}

// ── Polling loop, one per bridge ──

async function poll(b: Live) {
  let backoff = 1_000
  while (!b.abort.signal.aborted) {
    const [row] = await db.select().from(bridges).where(eq(bridges.id, b.id))
    if (!row) return stopBridge(b.userId)
    try {
      const updates = await telegram<TgUpdate[]>(
        b.token,
        "getUpdates",
        { offset: (row.lastUpdateId ?? 0) + 1, timeout: POLL_SECONDS, allowed_updates: ["message", "callback_query"] },
        AbortSignal.any([b.abort.signal, AbortSignal.timeout((POLL_SECONDS + 10) * 1000)]),
      )
      backoff = 1_000
      if (row.status === "error") await setStatus(row.id, { status: row.chatId ? "active" : "linking", error: null })
      for (const u of updates) {
        // Moving the offset first means a message that breaks the handler isn't retried forever
        await setStatus(row.id, { lastUpdateId: u.update_id })
        const fresh = { ...row, lastUpdateId: u.update_id }
        try {
          if (u.message) await onMessage(b, fresh, u.message)
          else if (u.callback_query) await onButton(b, fresh, u.callback_query)
        } catch (err) {
          console.error("Telegram message failed:", err instanceof Error ? err.message : err)
          if (u.message) await send(b, "Something went wrong handling that. Try again.").catch(() => {})
        }
        if (!row.chatId && b.chatId) row.chatId = b.chatId
      }
    } catch (err) {
      if (b.abort.signal.aborted) return
      const code = err instanceof TelegramError ? err.code : undefined
      const message =
        code === 401 ? "Telegram rejected the bot token. Paste a new one." :
        code === 409 ? "Another program is reading this bot's messages. Stop it, or make a new bot for Crew." :
        err instanceof Error ? err.message : String(err)
      await setStatus(row.id, { status: "error", error: message }).catch(() => {})
      publish(b.userId, { type: "bridge.updated" })
      if (code === 401) return stopBridge(b.userId)
      await new Promise((r) => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 60_000)
    }
  }
}

export function stopBridge(userId: string) {
  const b = live.get(userId)
  b?.abort.abort()
  live.delete(userId)
}

export function startBridge(row: Bridge) {
  stopBridge(row.userId)
  const b: Live = { id: row.id, userId: row.userId, token: decrypt(row.token), chatId: row.chatId, abort: new AbortController() }
  live.set(row.userId, b)
  void poll(b).catch((err) => console.error("Telegram bridge stopped:", err instanceof Error ? err.message : err))
}

// ── Outgoing: replies, requests that need an OK, takeovers ──

// How much of each reply was already sent, so a reply that continues after an
// approval only sends what's new
const sentLength = new Map<string, number>()

async function onRunFinished(b: Live, event: Extract<AppEvent, { type: "run.finished" }>) {
  const [run] = await db.select().from(runs).where(eq(runs.id, event.runId))
  if (!run?.chainId) return
  const [thread] = await db.select({ kind: threads.kind }).from(threads).where(eq(threads.id, event.threadId))
  if (!thread || thread.kind === "bot") return
  // Only conversations started from Telegram, or by a schedule or follow-up
  const [root] = await db.select({ metadata: messages.metadata }).from(messages).where(eq(messages.id, run.chainId))
  const meta = root?.metadata ?? {}
  if (meta.via !== "telegram" && !meta.scheduleId) return
  const [bot] = await db.select({ name: bots.name }).from(bots).where(eq(bots.id, event.botId))
  if (event.status !== "completed") {
    if (event.status === "failed") await send(b, `${bot?.name ?? "The bot"} couldn't finish: ${run.error ?? "something went wrong"}`)
    return
  }
  const [reply] = await db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(and(eq(messages.runId, run.id), eq(messages.role, "assistant")))
  if (!reply) return
  const text = reply.text.slice(sentLength.get(reply.id) ?? 0).trim()
  sentLength.set(reply.id, reply.text.length)
  if (sentLength.size > 2000) sentLength.delete(sentLength.keys().next().value!)
  if (text) await send(b, `${bot?.name ?? "Bot"}:\n${text}`)
}

function describe(input: Record<string, unknown>) {
  const command = typeof input.command === "string" ? input.command : null
  const raw = command ?? JSON.stringify(input)
  return raw.length > 600 ? `${raw.slice(0, 600)}…` : raw
}

async function onApproval(b: Live, approvalId: string) {
  const [row] = await db
    .select({ a: approvals, botName: bots.name })
    .from(approvals)
    .innerJoin(bots, eq(bots.id, approvals.botId))
    .where(eq(approvals.id, approvalId))
  if (!row || row.a.status !== "pending") return
  await send(b, `🔐 ${row.botName} wants to: ${row.a.title}\n\n${describe(row.a.input)}`, {
    reply_markup: {
      inline_keyboard: [[
        { text: "Allow", callback_data: `ap:${row.a.id}:1` },
        { text: "Deny", callback_data: `ap:${row.a.id}:0` },
      ]],
    },
  })
}

async function onTakeover(b: Live, takeoverId: string) {
  const [row] = await db
    .select({ t: takeovers, botName: bots.name })
    .from(takeovers)
    .innerJoin(bots, eq(bots.id, takeovers.botId))
    .where(eq(takeovers.id, takeoverId))
  if (!row) return
  await send(b, `🙋 ${row.botName} needs you: ${row.t.reason}\n${row.t.instruction}\n\nOpen Crew on your computer to take over its screen.`)
}

function onEvent(userId: string, event: AppEvent) {
  const b = live.get(userId)
  if (!b?.chatId) return
  const job =
    event.type === "run.finished" ? onRunFinished(b, event) :
    event.type === "approval.requested" ? onApproval(b, event.approvalId) :
    event.type === "takeover.requested" ? onTakeover(b, event.takeoverId) :
    null
  void job?.catch((err) => console.error("Telegram send failed:", err instanceof Error ? err.message : err))
}

// On server start: resume every bridge and listen for events to forward
export async function startBridges() {
  tap(onEvent)
  for (const row of await db.select().from(bridges).where(eq(bridges.kind, "telegram"))) {
    if (row.status === "error" && row.error?.includes("token")) continue
    try {
      startBridge(row)
    } catch (err) {
      console.error("Couldn't resume a Telegram bridge:", err instanceof Error ? err.message : err)
    }
  }
}
