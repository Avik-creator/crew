import { DeviceDriver, getDisplayDriver, LazyDriver, type ComputerDriver } from "@crew/computer"
import {
  approvals,
  bots,
  db,
  devices,
  messages,
  runs,
  threadMembers,
  threads,
  user,
  userSettings,
  type Bot,
  type Message,
  type Run,
  type Thread,
} from "@crew/db"
import { loadConnectorTools, type ConnectorToolset } from "@crew/mcp"
import { LIMITS, type CrewMessageMetadata } from "@crew/shared"
import {
  convertToModelMessages,
  generateId,
  hasToolCall,
  isStepCount,
  streamText,
  type ModelMessage,
  type Tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai"
import { and, eq, gte, inArray, ne } from "drizzle-orm"

import { builtinApproval } from "./approval"
import type { EventSink, TurnContext, TurnDispatcher } from "./context"
import { loadHistory, stripImages } from "./history"
import { languageModel, SCREEN_MODEL } from "./model"
import { buildSystemPrompt } from "./prompt"
import { saveMessage } from "./store"
import { collabTools } from "./tools/collab"
import { appTools } from "./tools/apps"
import { browserTools } from "./tools/browser"
import { computerTools, SCREEN_TOOLS } from "./tools/computer"
import { loadMemories, memoryTools } from "./tools/memory"
import { teamTools } from "./tools/team"

export type TurnDeps = {
  dispatcher: TurnDispatcher
  events: EventSink
  // Receives the live UI stream; resolves once it has been fully consumed
  pipe: (stream: ReadableStream<UIMessageChunk>) => Promise<void>
  signal?: AbortSignal
}

export type TurnResult = { status: "completed" | "waiting" | "skipped" | "failed" | "cancelled"; runId?: string; reason?: string }

// Reasons that come from the person and so ignore the daily wake budget
const PERSON_REASONS = new Set(["chat", "approval", "takeover", "group"])

// Keep only the newest screenshots in context during long screen sessions
const KEEP_IMAGES = 3
function pruneImages(msgs: ModelMessage[]): ModelMessage[] {
  let seen = 0
  return [...msgs]
    .reverse()
    .map((m) => {
      if (m.role !== "tool") return m
      return {
        ...m,
        content: m.content.map((part) => {
          if (part.type !== "tool-result" || part.output.type !== "content") return part
          const hasImage = part.output.value.some((v) => v.type === "file" || v.type === "image-data")
          if (!hasImage) return part
          seen++
          if (seen <= KEEP_IMAGES) return part
          return {
            ...part,
            output: { type: "content" as const, value: part.output.value.filter((v) => v.type === "text") },
          }
        }),
      }
    })
    .reverse() as ModelMessage[]
}

// Turns this bot started on its own today, not counting this one
async function wakesToday(botId: string, runId: string) {
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.botId, botId),
        gte(runs.startedAt, since),
        ne(runs.trigger, "chat"),
        ne(runs.status, "skipped"),
        ne(runs.id, runId),
      ),
    )
  return rows.length
}

async function skip(runId: string, reason: string): Promise<TurnResult> {
  await db.update(runs).set({ status: "skipped", error: reason, completedAt: new Date() }).where(eq(runs.id, runId))
  return { status: "skipped", runId, reason }
}

async function driverFor(ctx: Omit<TurnContext, "dispatcher" | "events">): Promise<ComputerDriver> {
  const { bot } = ctx
  if (bot.runsOn === "device" && bot.deviceId) {
    const [device] = await db.select({ capabilities: devices.capabilities }).from(devices).where(eq(devices.id, bot.deviceId))
    return new DeviceDriver(
      bot.deviceId,
      { runId: ctx.runId, botId: bot.id, botName: bot.name, background: ctx.background },
      { apps: device?.capabilities.apps ?? false },
    )
  }
  return new LazyDriver("cloud", () => getDisplayDriver(ctx.userId, bot.displayNumber), {
    openApp: true,
    saveLogins: true,
    browser: true,
    apps: true,
  })
}

// Where a bot-to-bot exchange started, so the answer can go back there
async function originOf(thread: Thread, trigger: Message | undefined) {
  if (thread.kind !== "bot") return thread.id
  return ((trigger?.metadata as { originThreadId?: string } | null)?.originThreadId ?? null) as string | null
}

type ToolPart = { type: string; toolName?: string; toolCallId?: string; state?: string; input?: unknown; approval?: { id: string } }

// Models fill every optional argument. Unused blanks and placeholders are omitted
// before any tool runs.
const PLACEHOLDER = new Set(["any", "all", "none", "null", "undefined", "default", "n/a", "*", "x"])

function omitBlankInput(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(omitBlankInput).filter((value) => value != null && value !== "")
  if (!input || typeof input !== "object") return input
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue
    if (typeof value === "string") {
      const text = value.trim()
      if (!text || PLACEHOLDER.has(text.toLowerCase())) continue
      cleaned[key] = value
      continue
    }
    if (typeof value === "object") {
      const nested = omitBlankInput(value)
      const empty = Array.isArray(nested) ? nested.length === 0 : !nested || Object.keys(nested as object).length === 0
      if (!empty) cleaned[key] = nested
      continue
    }
    cleaned[key] = value
  }
  return cleaned
}

// Text these tools type or press is meant literally, even "x" or "any"
const LITERAL_INPUT = new Set(["useScreen", "useApp"])

function prepareTools(tools: Record<string, Tool>): Record<string, Tool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const execute = (tool as unknown as { execute?: (input: unknown, options: unknown) => unknown }).execute
      if (!execute || LITERAL_INPUT.has(name)) return [name, tool]
      return [name, { ...tool, execute: (input: unknown, options: unknown) => execute.call(tool, omitBlankInput(input), options) }]
    }),
  )
}

// One bot turn: read the thread, think and act with tools, stream the reply
// live, save it, then record approvals and pass answers between bots. The
// runner has already claimed `run`; this records how it ends.
export async function runTurn(run: Run, deps: TurnDeps): Promise<TurnResult> {
  const payload = run.payload
  const runId = run.id
  if (!payload) return skip(runId, "The run has nothing to do")
  const [[bot], [thread]] = await Promise.all([
    db.select().from(bots).where(eq(bots.id, payload.botId)),
    db.select().from(threads).where(eq(threads.id, payload.threadId)),
  ])
  if (!bot || !thread) return skip(runId, "Bot or thread was deleted")
  if (bot.status !== "active") return skip(runId, `${bot.name} is ${bot.status}`)
  if (payload.hop > LIMITS.maxHops) return skip(runId, "Too many hops")
  if (!PERSON_REASONS.has(payload.reason) && (await wakesToday(bot.id, runId)) >= bot.wakeBudgetDaily) {
    return skip(runId, `${bot.name} used today's wake budget`)
  }

  const [[owner], [settings]] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, bot.userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, bot.userId)),
  ])
  const background = payload.background ?? false
  const ctx: TurnContext = {
    userId: bot.userId,
    userName: owner?.name?.split(" ")[0] || "the person",
    bot,
    thread,
    runId,
    payload,
    background,
    dispatcher: deps.dispatcher,
    events: deps.events,
  }
  const emit = (e: Parameters<EventSink["emit"]>[1]) => deps.events.emit(ctx.userId, e).catch(() => {})
  await emit({ type: "run.started", threadId: thread.id, runId, botId: bot.id })

  // Closed at the end even if something else in setup fails first
  let connecting: Promise<ConnectorToolset> | undefined
  try {
    // Everything the turn needs before the model, loaded side by side
    connecting = loadConnectorTools({ userId: ctx.userId, botId: bot.id, background })
    const [connectors, driver, builtin, trigger, team, members, memories, history] = await Promise.all([
      connecting,
      driverFor(ctx),
      builtinApproval({ runsOn: bot.runsOn, deviceId: bot.deviceId }),
      payload.triggerMessageId
        ? db
            .select()
            .from(messages)
            .where(eq(messages.id, payload.triggerMessageId))
            .then((rows) => rows[0])
        : undefined,
      db.select({ id: bots.id, name: bots.name, job: bots.job }).from(bots).where(and(eq(bots.userId, ctx.userId), eq(bots.status, "active"))),
      db
        .select({ id: bots.id, name: bots.name, job: bots.job })
        .from(threadMembers)
        .innerJoin(bots, eq(bots.id, threadMembers.botId))
        .where(eq(threadMembers.threadId, thread.id)),
      loadMemories(ctx.userId, bot.id),
      loadHistory(thread.id, bot.id),
    ])
    const originThreadId = await originOf(thread, trigger)
    const tools = prepareTools({
      ...computerTools(driver),
      ...(driver.apps ? appTools(driver.apps) : {}),
      ...(driver.browser ? browserTools(driver.browser) : {}),
      ...memoryTools(ctx),
      ...collabTools(ctx, originThreadId),
      ...(bot.role === "chief" ? teamTools(ctx) : {}),
      ...connectors.tools,
    })
    const approvalOf = connectors.approval

    const peer = thread.kind === "bot" ? members.find((m) => m.id !== bot.id) : undefined
    const system = buildSystemPrompt({
      bot,
      userName: ctx.userName,
      timeZone: settings?.timeZone ?? "UTC",
      thread,
      members,
      team,
      memories,
      connectors: {
        available: [...new Set(Object.values(connectors.info).map((i) => i.serverName))],
        unavailable: connectors.unavailable,
        instructions: connectors.instructions,
      },
      background,
      peerName: peer?.name,
      appControl: !!driver.apps,
    })

    const metadata: CrewMessageMetadata = {
      authorType: "bot",
      authorId: bot.id,
      botId: bot.id,
      runId,
      createdAt: new Date().toISOString(),
    }
    // A bot on the default model hands the screen to one that can aim, from
    // its first screenshot on. A model the person picked is kept throughout.
    const screenModel = bot.model ? undefined : languageModel(SCREEN_MODEL())
    const result = streamText({
      model: languageModel(bot.model),
      system,
      messages: await convertToModelMessages(history, { tools, ignoreIncompleteToolCalls: true }),
      tools,
      toolApproval: ({ toolCall }) => approvalOf[toolCall.toolName] ?? builtin(toolCall.toolName, toolCall.input),
      stopWhen: [isStepCount(LIMITS.maxStepsPerTurn), hasToolCall("requestTakeover")],
      prepareStep: ({ messages: stepMessages, steps }) => ({
        messages: pruneImages(stepMessages),
        ...(screenModel && steps.some((s) => s.toolCalls.some((c) => SCREEN_TOOLS.has(c.toolName))) ? { model: screenModel } : {}),
      }),
      abortSignal: deps.signal,
    })

    let saved: Promise<UIMessage> | undefined
    const stream = result.toUIMessageStream({
      originalMessages: history,
      generateMessageId: generateId,
      messageMetadata: ({ part }) => (part.type === "start" ? metadata : undefined),
      onFinish: ({ responseMessage }) => {
        saved = (async () => {
          const parts = stripImages(responseMessage.parts)
          if (parts.length) {
            const row = await saveMessage({
              id: responseMessage.id,
              threadId: thread.id,
              role: "assistant",
              authorType: "bot",
              authorId: bot.id,
              parts,
              metadata: { ...metadata, ...(responseMessage.metadata as object | undefined) },
              chainId: payload.chainId,
              hop: payload.hop,
              runId,
            })
            await emit({ type: "message.created", threadId: thread.id, messageId: row.id, botId: bot.id })
          }
          return { ...responseMessage, parts: parts as UIMessage["parts"] }
        })()
      },
    })
    await deps.pipe(stream)
    const reply = saved ? await saved : undefined
    const usage = await Promise.resolve(result.totalUsage).catch(() => undefined)
    const steps = (await Promise.resolve(result.steps).catch(() => [])).length

    // Stopped by the person: the stream ends quietly and what was written so
    // far is saved, but nothing else follows from it
    if (deps.signal?.aborted) {
      await db
        .update(runs)
        .set({ status: "cancelled", usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, steps }, completedAt: new Date() })
        .where(eq(runs.id, runId))
      await emit({ type: "run.finished", threadId: thread.id, runId, botId: bot.id, status: "cancelled" })
      await emit({ type: "thread.updated", threadId: thread.id })
      return { status: "cancelled", runId }
    }

    // Pending approvals become inbox items; the turn resumes once decided
    const pending = ((reply?.parts ?? []) as ToolPart[]).filter((p) => p.state === "approval-requested" && p.approval)
    if (pending.length && reply) {
      const rows = await db
        .insert(approvals)
        .values(
          pending.map((p) => {
            const name = p.type === "dynamic-tool" ? p.toolName! : p.type.slice(5)
            const info = connectors.info[name]
            return {
              userId: ctx.userId,
              runId,
              botId: bot.id,
              threadId: thread.id,
              kind: info ? ("mcp" as const) : ("device" as const),
              serverId: info?.serverId ?? null,
              toolName: info?.toolName ?? name,
              toolCallId: p.approval!.id,
              title: info ? `${info.title} in ${info.serverName}` : name,
              input: (p.input ?? {}) as Record<string, unknown>,
              hard: info?.decision === "hard",
            }
          }),
        )
        .returning({ id: approvals.id, title: approvals.title })
      for (const r of rows) await emit({ type: "approval.requested", approvalId: r.id, threadId: thread.id, botId: bot.id })
      await emit({
        type: "notify",
        title: `${bot.name} needs your OK`,
        body: rows.map((r) => r.title).join(", "),
        threadId: thread.id,
      })
    }

    // A bot that answered a teammate's message sends the answer back
    const replyText = reply ? (reply.parts as ToolPart[]).filter((p) => p.type === "text").map((p) => (p as { text?: string }).text).join("\n").trim() : ""
    if (payload.reason === "bot_message" && trigger?.authorId && replyText) {
      await deliverReply(ctx, trigger.authorId, replyText, originThreadId)
    }

    const status = pending.length ? "waiting" : "completed"
    await db
      .update(runs)
      .set({
        status,
        usage: { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, steps },
        completedAt: new Date(),
      })
      .where(eq(runs.id, runId))
    await emit({ type: "run.finished", threadId: thread.id, runId, botId: bot.id, status: "completed" })
    await emit({ type: "thread.updated", threadId: thread.id })
    if (background && replyText && !pending.length && thread.kind !== "bot") {
      await emit({ type: "notify", title: bot.name, body: replyText.slice(0, 140), threadId: thread.id })
    }
    return { status, runId }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const cancelled = deps.signal?.aborted ?? false
    await db
      .update(runs)
      .set({ status: cancelled ? "cancelled" : "failed", error: message, completedAt: new Date() })
      .where(eq(runs.id, runId))
    if (!cancelled) {
      const note = await saveMessage({
        threadId: thread.id,
        role: "system",
        authorType: "system",
        authorId: bot.id,
        parts: [{ type: "text", text: `${bot.name} ran into a problem: ${message}` }],
        runId,
      })
      await emit({ type: "message.created", threadId: thread.id, messageId: note.id, botId: bot.id })
    }
    await emit({ type: "run.finished", threadId: thread.id, runId, botId: bot.id, status: cancelled ? "cancelled" : "failed" })
    return { status: "failed", runId, reason: message }
  } finally {
    await connecting?.then(
      (connectors) => connectors.close(),
      () => {},
    )
  }
}

// Copies the answer into the conversation the question came from and wakes
// the asking bot there, so the person sees the whole exchange in one place
async function deliverReply(ctx: TurnContext, askerId: string, text: string, originThreadId: string | null) {
  const hop = ctx.payload.hop + 1
  if (hop > LIMITS.maxHops) return
  const target = originThreadId ?? ctx.thread.id
  if (originThreadId) {
    const msg = await saveMessage({
      threadId: originThreadId,
      role: "assistant",
      authorType: "bot",
      authorId: ctx.bot.id,
      parts: [{ type: "text", text }],
      addressedToBotId: askerId,
      chainId: ctx.payload.chainId,
      hop,
      runId: ctx.runId,
      metadata: { authorType: "bot", botId: ctx.bot.id, via: "bot_message", botThreadId: ctx.thread.id },
    })
    await ctx.events.emit(ctx.userId, { type: "message.created", threadId: originThreadId, messageId: msg.id, botId: ctx.bot.id })
  }
  const [origin] = await db.select({ kind: threads.kind }).from(threads).where(eq(threads.id, target))
  await ctx.dispatcher.enqueue({
    threadId: target,
    botId: askerId,
    reason: "reply",
    chainId: ctx.payload.chainId,
    hop,
    background: origin?.kind === "bot" ? true : ctx.background,
  })
}

// Bots that should hear about a person's message in a thread, for callers
// that don't route (direct threads have exactly one bot)
export async function threadBots(threadId: string) {
  const rows = await db
    .select({ id: bots.id })
    .from(threadMembers)
    .innerJoin(bots, eq(bots.id, threadMembers.botId))
    .where(and(eq(threadMembers.threadId, threadId), inArray(bots.status, ["active"])))
  return rows.map((r) => r.id)
}

export type { Bot }
