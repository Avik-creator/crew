import { randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { bots, db, messages, runs, type Run } from "@crew/db"
import type { TurnPayload } from "@crew/shared"
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { convertToModelMessages, experimental_createSteering, type Experimental_Steering, type UIMessage, type UIMessageChunk, type UserModelMessage } from "ai"

import type { EventSink, TurnDispatcher } from "./context"
import { liveReplies } from "./live"
import { saveMessage, settleToolCalls } from "./store"
import { runTurn } from "./turn"

// A running turn renews its claim every few seconds. A claim that lapses means
// its process died, and the sweep finds it.
const LEASE_MS = 20_000
const HEARTBEAT_MS = 5_000
const SWEEP_MS = 5_000

const leaseEnd = () => new Date(Date.now() + LEASE_MS)

// What the person wrote, which can reach a turn that is already working
const STEERABLE = new Set<TurnPayload["reason"]>(["chat", "group"])

type ActiveTurn = {
  controller: AbortController
  botId: string
  threadId: string | null
  steering: Experimental_Steering
  // Messages sent to this turn that it hasn't taken or turned down yet
  steers: Set<(queueIt: boolean) => void>
}

// The person's saved message as the model reads it, pictures included
async function steeringMessage(messageId: string): Promise<UserModelMessage | null> {
  const [row] = await db.select({ parts: messages.parts }).from(messages).where(eq(messages.id, messageId))
  if (!row) return null
  const parts = (row.parts as UIMessage["parts"]).filter((p) => p.type === "text" || p.type === "file")
  const [message] = await convertToModelMessages([{ role: "user", parts }])
  return message?.role === "user" ? message : null
}

// Runs bot turns in this process. A turn is a row in `runs`: queued, claimed
// under a per-bot lock so each bot does one thing at a time, kept alive by a
// heartbeat, and started by the sweep if a start was missed.
export class TurnRunner implements TurnDispatcher {
  readonly owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  private active = new Map<string, ActiveTurn>()
  private sweeper: NodeJS.Timeout | undefined
  private stopping = false

  constructor(private events: EventSink) {}

  start() {
    this.sweeper = setInterval(() => void this.sweep().catch((err) => console.error("Run sweep failed:", err)), SWEEP_MS)
    void this.sweep().catch((err) => console.error("Run sweep failed:", err))
  }

  // Queues a turn and starts it now if the bot is free. Returns the run id:
  // the running turn's, when the message went to that turn instead.
  async enqueue(payload: TurnPayload): Promise<string> {
    return this.steer(payload) ?? this.queue(payload)
  }

  private async queue(payload: TurnPayload): Promise<string> {
    const [bot] = await db.select({ userId: bots.userId }).from(bots).where(eq(bots.id, payload.botId))
    if (!bot) throw new Error("That bot no longer exists")
    const [row] = await db
      .insert(runs)
      .values({
        userId: bot.userId,
        botId: payload.botId,
        threadId: payload.threadId,
        trigger: payload.reason,
        status: "queued",
        payload,
        chainId: payload.chainId,
        hop: payload.hop,
      })
      .returning({ id: runs.id })
    void this.next(payload.botId)
    return row!.id
  }

  // The person wrote where this bot is already working: the message joins that
  // turn at its next step instead of waiting for it to end. A message the turn
  // doesn't take, because it ended first, gets a turn of its own. One sent to a
  // turn the person stopped is dropped with it.
  private steer(payload: TurnPayload): string | null {
    if (!STEERABLE.has(payload.reason) || !payload.triggerMessageId) return null
    const found = [...this.active].find(([, t]) => t.botId === payload.botId && t.threadId === payload.threadId)
    if (!found) return null
    const [runId, turn] = found
    let open = true
    const settle = (queueIt: boolean) => {
      if (!open) return
      open = false
      turn.steers.delete(settle)
      if (queueIt) void this.queue(payload).catch((err) => console.error("Couldn't queue a turn:", err))
    }
    turn.steers.add(settle)
    void (async () => {
      const message = await steeringMessage(payload.triggerMessageId!)
      if (!open) return
      if (!message) return settle(false)
      const outcome = await turn.steering.steer(message, { id: payload.triggerMessageId! })
      settle(outcome.type === "not-delivered" && outcome.reason !== "aborted")
    })().catch((err) => {
      console.error("Couldn't pass a message to a running turn:", err)
      settle(true)
    })
    return runId
  }

  // Stops a turn that's running here, or drops one still waiting its turn
  async cancel(runId: string) {
    const local = this.active.get(runId)
    if (local) return local.controller.abort()
    const [run] = await db
      .update(runs)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.status, "queued")))
      .returning()
    if (!run) return
    liveReplies.end(run.id)
    if (run.threadId) {
      await this.events.emit(run.userId, { type: "run.finished", threadId: run.threadId, runId: run.id, botId: run.botId, status: "cancelled" })
    }
  }

  // Shutting down: turns running here can't finish, so they end now instead of
  // waiting for their claim to lapse. Queued turns start in the next process.
  async stop() {
    this.stopping = true
    clearInterval(this.sweeper)
    const ids = [...this.active.keys()]
    if (!ids.length) return
    const stopped = await db
      .update(runs)
      .set({ status: "failed", error: "Crew's server restarted", completedAt: new Date() })
      .where(and(inArray(runs.id, ids), eq(runs.status, "running")))
      .returning()
    await Promise.all(stopped.map((run) => this.interrupted(run)))
  }

  private async next(botId: string) {
    if (this.stopping) return
    const run = await this.claim(botId).catch((err) => {
      console.error("Couldn't start a turn:", err)
      return null
    })
    if (run) void this.execute(run)
  }

  private claim(botId: string): Promise<Run | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${botId}))`)
      const [busy] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.botId, botId), eq(runs.status, "running")))
        .limit(1)
      if (busy) return null
      const [queued] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.botId, botId), eq(runs.status, "queued")))
        .orderBy(asc(runs.createdAt))
        .limit(1)
      if (!queued) return null
      const [run] = await tx
        .update(runs)
        .set({ status: "running", owner: this.owner, leaseUntil: leaseEnd(), startedAt: new Date() })
        .where(eq(runs.id, queued.id))
        .returning()
      return run ?? null
    })
  }

  private async execute(run: Run) {
    const controller = new AbortController()
    const turn: ActiveTurn = { controller, botId: run.botId, threadId: run.threadId, steering: experimental_createSteering(), steers: new Set() }
    this.active.set(run.id, turn)
    const heartbeat = setInterval(() => void this.renew(run.id, controller), HEARTBEAT_MS)
    let crash: unknown
    try {
      await runTurn(run, {
        dispatcher: this,
        events: this.events,
        signal: controller.signal,
        steering: turn.steering,
        pipe: (stream) => this.pipe(run.id, stream),
      })
    } catch (err) {
      crash = err
      console.error("Turn crashed:", err)
    } finally {
      clearInterval(heartbeat)
      this.active.delete(run.id)
      liveReplies.end(run.id)
      // A turn that stopped before the model ran never answers for its messages
      for (const settle of [...turn.steers]) settle(!controller.signal.aborted)
    }
    if (this.stopping) return
    // A turn that threw before it could record how it ended
    const [left] = await db
      .update(runs)
      .set({ status: "failed", error: crash instanceof Error ? crash.message : "The turn stopped unexpectedly", completedAt: new Date() })
      .where(and(eq(runs.id, run.id), eq(runs.status, "running"), eq(runs.owner, this.owner)))
      .returning()
    if (left?.threadId) {
      await this.events
        .emit(left.userId, { type: "run.finished", threadId: left.threadId, runId: left.id, botId: left.botId, status: "failed" })
        .catch(() => {})
    }
    await this.next(run.botId)
  }

  private async pipe(runId: string, stream: ReadableStream<UIMessageChunk>) {
    for await (const chunk of stream) liveReplies.push(runId, chunk)
  }

  private async renew(runId: string, controller: AbortController) {
    const kept = await db
      .update(runs)
      .set({ leaseUntil: leaseEnd() })
      .where(and(eq(runs.id, runId), eq(runs.owner, this.owner), eq(runs.status, "running")))
      .returning({ id: runs.id })
      .catch(() => null)
    // Someone else ended it (the sweep, after this process stalled): stop working
    if (kept && !kept.length) controller.abort()
  }

  private async sweep() {
    if (this.stopping) return
    // Turns whose process died aren't replayed: they may already have sent an
    // email or clicked something, so the person decides whether to ask again
    const stale = await db
      .update(runs)
      .set({ status: "failed", error: "Crew's server stopped while this was running", completedAt: new Date() })
      .where(and(eq(runs.status, "running"), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, new Date()))))
      .returning()
    await Promise.all(stale.map((run) => this.interrupted(run)))

    const waiting = await db.selectDistinct({ botId: runs.botId }).from(runs).where(eq(runs.status, "queued"))
    await Promise.all(waiting.map(({ botId }) => this.next(botId)))
  }

  // Leaves a note where the turn was working, so its silence isn't a mystery
  private async interrupted(run: Run) {
    liveReplies.end(run.id)
    if (!run.threadId) return
    // Its unfinished tool calls stop showing as running
    const settled = await settleToolCalls(run.threadId, run.botId, run.chainId, "Stopped because Crew's server restarted.").catch(() => [] as string[])
    for (const messageId of settled) {
      await this.events.emit(run.userId, { type: "message.created", threadId: run.threadId, messageId, botId: run.botId }).catch(() => {})
    }
    const [bot] = await db.select({ name: bots.name }).from(bots).where(eq(bots.id, run.botId))
    const note = await saveMessage({
      threadId: run.threadId,
      role: "system",
      authorType: "system",
      authorId: run.botId,
      parts: [{ type: "text", text: `${bot?.name ?? "The bot"} stopped because Crew's server restarted. Ask again if you still need it.` }],
      runId: run.id,
    })
    await this.events.emit(run.userId, { type: "message.created", threadId: run.threadId, messageId: note.id, botId: run.botId }).catch(() => {})
    await this.events
      .emit(run.userId, { type: "run.finished", threadId: run.threadId, runId: run.id, botId: run.botId, status: "failed" })
      .catch(() => {})
  }
}
