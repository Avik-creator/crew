import { botServers, bots, db, threadMembers, threads, userSettings, type Bot } from "@crew/db"
import { BOT_COLOR_NAMES, type BotInput } from "@crew/shared"
import { and, eq } from "drizzle-orm"

// Creating and arranging bots. The server's routes and the chief's tools both
// go through here, so a bot made from chat is the same as one made in the app.

// Smallest display number not taken by another of the person's bots (:1, :2…)
async function freeDisplay(userId: string) {
  const used = new Set((await db.select({ n: bots.displayNumber }).from(bots).where(eq(bots.userId, userId))).map((r) => r.n))
  let n = 1
  while (used.has(n)) n++
  return n
}

export async function setBotServers(botId: string, serverIds: string[]) {
  await db.delete(botServers).where(eq(botServers.botId, botId))
  if (serverIds.length) await db.insert(botServers).values(serverIds.map((serverId) => ({ botId, serverId })))
}

// A color the person's other bots use least, so a new face stands out
async function freshColor(userId: string) {
  const counts = new Map<string, number>(BOT_COLOR_NAMES.map((c) => [c, 0]))
  for (const b of await db.select({ color: bots.color }).from(bots).where(eq(bots.userId, userId))) {
    counts.set(b.color, (counts.get(b.color) ?? 0) + 1)
  }
  const least = Math.min(...counts.values())
  const options = BOT_COLOR_NAMES.filter((c) => counts.get(c) === least)
  return options[Math.floor(Math.random() * options.length)]!
}

export type NewBot = Partial<Pick<BotInput, "instructions" | "model" | "runsOn" | "deviceId" | "avatar" | "color" | "wakeBudgetDaily">> &
  Pick<BotInput, "name" | "job"> & { role?: Bot["role"]; serverIds?: string[] }

// A bot and its direct chat, in one transaction
export async function createBot(userId: string, input: NewBot): Promise<{ bot: Bot; threadId: string }> {
  const { serverIds = [], ...values } = input
  const color = values.color ?? (await freshColor(userId))
  const result = await db.transaction(async (tx) => {
    const displayNumber = await freeDisplay(userId)
    const [bot] = await tx
      .insert(bots)
      .values({ ...values, avatar: values.avatar ?? "", instructions: values.instructions ?? "", color, userId, displayNumber })
      .returning()
    const [thread] = await tx.insert(threads).values({ userId, kind: "direct" }).returning()
    await tx.insert(threadMembers).values({ threadId: thread!.id, botId: bot!.id })
    return { bot: bot!, threadId: thread!.id }
  })
  await setBotServers(result.bot.id, serverIds)
  return result
}

export async function createGroup(userId: string, input: { name: string; goal?: string; botIds: string[] }) {
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(threads).values({ userId, kind: "group", name: input.name, goal: input.goal ?? "" }).returning()
    await tx.insert(threadMembers).values(input.botIds.map((botId) => ({ threadId: t!.id, botId })))
    return t!
  })
}

export const CHIEF_DEFAULTS = {
  name: "Crew",
  job: "Your main assistant: sets up bots, groups and schedules, and gets the team moving",
  color: "amber",
} as const

export async function findChief(userId: string) {
  const [chief] = await db.select().from(bots).where(and(eq(bots.userId, userId), eq(bots.role, "chief")))
  return chief
}

// Every person gets a chief unless they removed it. Safe to call often: the
// unique index on (user, role=chief) stops a race from making two.
export async function ensureChief(userId: string) {
  const existing = await findChief(userId)
  if (existing) return existing
  const [settings] = await db.select({ dismissed: userSettings.chiefDismissed }).from(userSettings).where(eq(userSettings.userId, userId))
  if (settings?.dismissed) return undefined
  try {
    return (await createBot(userId, { ...CHIEF_DEFAULTS, role: "chief" })).bot
  } catch {
    return findChief(userId)
  }
}

// Removing the chief is remembered; bringing it back clears that
export async function setChiefDismissed(userId: string, dismissed: boolean) {
  await db
    .insert(userSettings)
    .values({ userId, chiefDismissed: dismissed })
    .onConflictDoUpdate({ target: userSettings.userId, set: { chiefDismissed: dismissed } })
}
