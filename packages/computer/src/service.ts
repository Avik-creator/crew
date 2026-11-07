import { createHmac } from "node:crypto"

import { computers, db } from "@crew/db"
import { LIMITS } from "@crew/shared"
import { eq, sql } from "drizzle-orm"

import { CloudDisplayDriver } from "./display"
import { getProvider } from "./providers"
import { Workstation } from "./workstation"

type Status = "creating" | "running" | "paused" | "error" | "none"
type StatusListener = (userId: string, status: Status) => void

const listeners = new Set<StatusListener>()
export function onComputerStatus(fn: StatusListener) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit(userId: string, status: Status) {
  for (const fn of listeners) fn(userId, status)
}

// A turn makes many tool calls; reuse the connection for a short while
const cache = new Map<string, { ws: Workstation; at: number }>()
const CACHE_MS = 60_000

const isGone = (err: unknown) => /not ?found|404|does not exist/i.test(err instanceof Error ? err.message : String(err))

// The person's computer, created on first need and resumed if it's sleeping.
// Serialized per person with an advisory lock so two bots can't create two.
export async function getWorkstation(userId: string): Promise<Workstation> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) {
    hit.at = Date.now()
    void hit.ws.computer.keepAlive(LIMITS.computerIdleMs)
    return hit.ws
  }

  const ws = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`computer:${userId}`}))`)
    let [row] = await tx.select().from(computers).where(eq(computers.userId, userId))
    // A computer that exists stays where it is; a new one goes to COMPUTER_PROVIDER
    const provider = getProvider(row?.sandboxId ? row.provider : null)
    const now = new Date()

    const create = async () => {
      emit(userId, "creating")
      const created = await provider.create({
        userId,
        resolution: [1280, 800],
        idleMs: LIMITS.computerIdleMs,
      })
      const values = {
        provider: provider.name,
        sandboxId: created.sandboxId,
        templateId: created.templateId,
        status: "running" as const,
        error: null,
        lastActiveAt: now,
        lastResumedAt: now,
      }
      ;[row] = await tx
        .insert(computers)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: computers.userId, set: values })
        .returning()
      return provider.connect(created.sandboxId, LIMITS.computerIdleMs)
    }

    let handle
    if (!row?.sandboxId) {
      handle = await create()
    } else {
      try {
        handle = await provider.connect(row.sandboxId, LIMITS.computerIdleMs)
        const wasSleeping = row.status !== "running"
        await tx
          .update(computers)
          .set({
            status: "running",
            error: null,
            lastActiveAt: now,
            ...(wasSleeping ? { lastResumedAt: now } : {}),
          })
          .where(eq(computers.userId, userId))
      } catch (err) {
        if (!isGone(err)) {
          await tx
            .update(computers)
            .set({ status: "error", error: err instanceof Error ? err.message : String(err) })
            .where(eq(computers.userId, userId))
          emit(userId, "error")
          throw err
        }
        // The sandbox was deleted outside the app: start a fresh one
        handle = await create()
      }
    }
    return new Workstation(handle)
  })

  await ws.bootstrap()
  emit(userId, "running")
  cache.set(userId, { ws, at: Date.now() })
  return ws
}

// Per-display VNC password, derived so nothing extra is stored
export function vncPassword(sandboxId: string, display: number) {
  const key = process.env.ENCRYPTION_KEY ?? "crew-dev"
  return createHmac("sha256", key).update(`${sandboxId}:${display}`).digest("base64url").slice(0, 8)
}

// The bot's own screen, running and ready to drive
export async function getDisplayDriver(userId: string, display: number) {
  const ws = await getWorkstation(userId)
  await ws.ensureDisplay(display, vncPassword(ws.computer.sandboxId, display))
  return new CloudDisplayDriver(ws.computer, display)
}

// Where the screen proxy connects for a bot's live view
export async function getScreenUpstream(userId: string, display: number) {
  const ws = await getWorkstation(userId)
  const password = vncPassword(ws.computer.sandboxId, display)
  const { webPort } = await ws.ensureDisplay(display, password)
  const ep = await ws.computer.portEndpoint(webPort)
  return { url: `${ep.url.replace(/^http/, "ws")}/websockify`, headers: ep.headers, password }
}

export async function pauseComputer(userId: string) {
  const [row] = await db.select().from(computers).where(eq(computers.userId, userId))
  if (!row?.sandboxId || row.status !== "running") return false
  await getProvider(row.provider).pause(row.sandboxId)
  cache.delete(userId)
  await db.update(computers).set({ status: "paused" }).where(eq(computers.userId, userId))
  emit(userId, "paused")
  return true
}

export async function destroyComputer(userId: string) {
  const [row] = await db.select().from(computers).where(eq(computers.userId, userId))
  if (row?.sandboxId) await getProvider(row.provider).destroy(row.sandboxId).catch(() => {})
  cache.delete(userId)
  await db
    .update(computers)
    .set({ sandboxId: null, status: "none" })
    .where(eq(computers.userId, userId))
  emit(userId, "none")
}

// Closes a screen and everything on it. A sleeping computer wakes for this,
// or the next bot given the same screen number would find the old windows.
export async function releaseDisplay(userId: string, display: number) {
  const [row] = await db.select().from(computers).where(eq(computers.userId, userId))
  if (row?.status !== "running" && row?.status !== "paused") return
  const ws = await getWorkstation(userId)
  await ws.removeDisplay(display)
}

// Records activity so the maintenance job knows the computer is in use
export async function touchComputer(userId: string) {
  await db.update(computers).set({ lastActiveAt: new Date() }).where(eq(computers.userId, userId))
}

export async function getComputerStatus(userId: string) {
  const [row] = await db.select().from(computers).where(eq(computers.userId, userId))
  return row ?? null
}

// Brings stored status in line with the provider (sandboxes pause themselves
// when idle) and cycles computers that near the provider's continuous-runtime cap
export async function maintainComputers() {
  const rows = await db.select().from(computers).where(eq(computers.status, "running"))
  let paused = 0
  let cycled = 0
  for (const row of rows) {
    if (!row.sandboxId) continue
    const provider = getProvider(row.provider)
    const running = await provider.isRunning(row.sandboxId)
    if (!running) {
      cache.delete(row.userId)
      await db.update(computers).set({ status: "paused" }).where(eq(computers.id, row.id))
      emit(row.userId, "paused")
      paused++
      continue
    }
    const since = row.lastResumedAt?.getTime() ?? row.createdAt.getTime()
    if (Date.now() - since > LIMITS.computerMaxContinuousMs) {
      // A pause resets the runtime clock; the next tool call resumes it
      await pauseComputer(row.userId)
      cycled++
    }
  }
  return { checked: rows.length, paused, cycled }
}
