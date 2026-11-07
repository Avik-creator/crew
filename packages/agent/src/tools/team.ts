import { bots, connections, db, devices, mcpServers, schedules, threadMembers, threads, userSettings } from "@crew/db"
import { BOT_COLOR_NAMES, BOT_INSTRUCTIONS_MAX, BOT_JOB_MAX, BOT_NAME_MAX, LIMITS } from "@crew/shared"
import { tool, type Tool } from "ai"
import { and, eq, inArray, ne } from "drizzle-orm"
import { z } from "zod"

import type { TurnContext } from "../context"
import { nextRunAt } from "../schedules"
import { createBot, createGroup, setBotServers } from "../team"

const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase()

async function teamOf(userId: string) {
  return db.select().from(bots).where(and(eq(bots.userId, userId), ne(bots.status, "hidden")))
}

// Connected apps the person can hand to a bot, by name
async function connectedApps(userId: string) {
  return db
    .select({ id: mcpServers.id, name: mcpServers.name })
    .from(connections)
    .innerJoin(mcpServers, eq(mcpServers.id, connections.serverId))
    .where(and(eq(connections.userId, userId), eq(connections.status, "active")))
}

async function serverIdsFor(userId: string, names: string[] | undefined) {
  if (!names?.length) return { ids: [] as string[], missing: [] as string[] }
  const apps = await connectedApps(userId)
  const ids: string[] = []
  const missing: string[] = []
  for (const name of names) {
    const hit = apps.find((a) => norm(a.name) === norm(name))
    if (hit) ids.push(hit.id)
    else missing.push(name)
  }
  return { ids, missing }
}

const botFields = {
  instructions: z.string().max(BOT_INSTRUCTIONS_MAX).optional().describe("How it should work: tone, rules, what to check first"),
  color: z.enum(BOT_COLOR_NAMES).optional(),
  emoji: z.string().max(8).optional().describe("One emoji for its face; leave out for the default face"),
  connectors: z.array(z.string()).optional().describe("Names of connected apps it may use, from listTeam"),
}

// The chief's tools: it sets up and rearranges the person's team. Every change
// tells the app, which refreshes the sidebar right away. Deleting stays with
// the person, in the app.
export function teamTools(ctx: TurnContext): Record<string, Tool> {
  const changed = () => ctx.events.emit(ctx.userId, { type: "team.updated" })

  return {
    listTeam: tool({
      description: "See the person's bots, groups, connected apps and linked Macs before you change anything.",
      inputSchema: z.object({}),
      execute: async () => {
        const team = await teamOf(ctx.userId)
        const groups = await db.select().from(threads).where(and(eq(threads.userId, ctx.userId), eq(threads.kind, "group")))
        const members = groups.length
          ? await db.select().from(threadMembers).where(inArray(threadMembers.threadId, groups.map((g) => g.id)))
          : []
        const macs = await db.select({ name: devices.name, status: devices.status }).from(devices).where(eq(devices.userId, ctx.userId))
        const nameOf = (id: string) => team.find((b) => b.id === id)?.name ?? "?"
        return {
          bots: team.map((b) => ({ name: b.name, job: b.job, status: b.status, worksOn: b.runsOn === "cloud" ? "cloud computer" : "their Mac", you: b.id === ctx.bot.id || undefined })),
          groups: groups.map((g) => ({ name: g.name, goal: g.goal || undefined, members: members.filter((m) => m.threadId === g.id).map((m) => nameOf(m.botId)) })),
          connectedApps: (await connectedApps(ctx.userId)).map((a) => a.name),
          macs,
        }
      },
    }),

    createBot: tool({
      description:
        "Create a new bot for the person. Give it a short human name and a focused job (one lane, like inbox, research or recruiting). " +
        "It gets its own chat and its own screen on the cloud computer, or works on their Mac if worksOnMac is set.",
      inputSchema: z.object({
        name: z.string().min(1).max(BOT_NAME_MAX),
        job: z.string().min(1).max(BOT_JOB_MAX).describe("One line, e.g. 'Keeps the inbox at zero and drafts replies'"),
        ...botFields,
        worksOnMac: z.boolean().optional().describe("Work on the person's linked Mac instead of the cloud computer"),
      }),
      execute: async ({ name, job, instructions, color, emoji, connectors, worksOnMac }) => {
        const team = await teamOf(ctx.userId)
        if (team.some((b) => norm(b.name) === norm(name))) return `There's already a bot called ${name}. Pick another name or update that one.`
        let deviceId: string | null = null
        if (worksOnMac) {
          const macs = await db.select({ id: devices.id }).from(devices).where(eq(devices.userId, ctx.userId))
          if (!macs.length) return "No Mac is linked yet. Ask the person to link one in Settings → This Mac, or make it a cloud bot."
          deviceId = macs[0]!.id
        }
        const apps = await serverIdsFor(ctx.userId, connectors)
        const { bot } = await createBot(ctx.userId, {
          name: name.trim(),
          job: job.trim(),
          instructions,
          color,
          avatar: emoji,
          runsOn: worksOnMac ? "device" : "cloud",
          deviceId,
          serverIds: apps.ids,
        })
        await changed()
        return [
          `Created ${bot.name}. It's in the sidebar now.`,
          apps.missing.length ? `Not connected, so not added: ${apps.missing.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      },
    }),

    updateBot: tool({
      description: "Change a bot: rename it, change its job or instructions, its connected apps, or pause and resume it.",
      inputSchema: z.object({
        name: z.string().describe("The bot's current name"),
        newName: z.string().min(1).max(BOT_NAME_MAX).optional(),
        job: z.string().min(1).max(BOT_JOB_MAX).optional(),
        ...botFields,
        status: z.enum(["active", "paused"]).optional(),
      }),
      execute: async ({ name, newName, job, instructions, color, emoji, connectors, status }) => {
        const team = await teamOf(ctx.userId)
        const bot = team.find((b) => norm(b.name) === norm(name))
        if (!bot) return `There's no bot called ${name}.`
        if (newName && team.some((b) => b.id !== bot.id && norm(b.name) === norm(newName))) return `There's already a bot called ${newName}.`
        if (status === "paused" && bot.id === ctx.bot.id) return "You can't pause yourself."
        await db
          .update(bots)
          .set({
            ...(newName ? { name: newName.trim() } : {}),
            ...(job ? { job: job.trim() } : {}),
            ...(instructions !== undefined ? { instructions } : {}),
            ...(color ? { color } : {}),
            ...(emoji !== undefined ? { avatar: emoji } : {}),
            ...(status ? { status } : {}),
          })
          .where(eq(bots.id, bot.id))
        let missing: string[] = []
        if (connectors) {
          const apps = await serverIdsFor(ctx.userId, connectors)
          await setBotServers(bot.id, apps.ids)
          missing = apps.missing
        }
        await changed()
        return [`Updated ${newName ?? bot.name}.`, missing.length ? `Not connected, so not added: ${missing.join(", ")}.` : ""].filter(Boolean).join(" ")
      },
    }),

    createGroup: tool({
      description: `Put ${LIMITS.groupMinBots} to ${LIMITS.groupMaxBots} bots in a group chat with the person, so the right one answers and they hand work to each other.`,
      inputSchema: z.object({
        name: z.string().min(1).max(50),
        goal: z.string().max(500).optional().describe("What the group is for"),
        members: z.array(z.string()).min(LIMITS.groupMinBots).max(LIMITS.groupMaxBots).describe("Bot names"),
      }),
      execute: async ({ name, goal, members }) => {
        const team = await teamOf(ctx.userId)
        const picked = members.map((m) => team.find((b) => norm(b.name) === norm(m)))
        const unknown = members.filter((_, i) => !picked[i])
        if (unknown.length) return `No bot called ${unknown.join(", ")}. Create it first or check the names with listTeam.`
        const ids = [...new Set(picked.map((b) => b!.id))]
        if (ids.length < LIMITS.groupMinBots) return `A group needs at least ${LIMITS.groupMinBots} different bots.`
        await createGroup(ctx.userId, { name: name.trim(), goal, botIds: ids })
        await changed()
        return `Created the group ${name} with ${picked.map((b) => b!.name).join(", ")}.`
      },
    }),

    createSchedule: tool({
      description:
        "Have a bot do something on a schedule: every weekday at 9, every Monday, or once at a set time. " +
        "The prompt is what the bot is asked each time, written as an instruction to it.",
      inputSchema: z.object({
        bot: z.string().describe("The bot's name"),
        name: z.string().min(1).max(80).describe("Short label, e.g. 'Morning AI digest'"),
        prompt: z.string().min(1).max(4000),
        cron: z.string().max(100).optional().describe("Repeating, as cron in the person's time zone, e.g. '0 9 * * 1-5'"),
        runAt: z.string().optional().describe("Once, as an ISO date-time"),
      }),
      execute: async ({ bot: botName, name, prompt, cron, runAt }) => {
        if (!!cron === !!runAt) return "Give either cron for a repeating schedule or runAt for a single time."
        const team = await teamOf(ctx.userId)
        const bot = team.find((b) => norm(b.name) === norm(botName))
        if (!bot) return `There's no bot called ${botName}.`
        const when = runAt ? new Date(runAt) : null
        if (when && Number.isNaN(when.getTime())) return `"${runAt}" isn't a date I can read.`
        const [settings] = await db.select({ timeZone: userSettings.timeZone }).from(userSettings).where(eq(userSettings.userId, ctx.userId))
        const values = { userId: ctx.userId, botId: bot.id, name, prompt, cron: cron ?? null, runAt: when, timeZone: settings?.timeZone ?? "UTC", enabled: true }
        let next: Date | null
        try {
          next = nextRunAt(values)
        } catch (err) {
          return `Couldn't schedule that: ${err instanceof Error ? err.message : String(err)}`
        }
        if (!next) return "That time has already passed."
        await db.insert(schedules).values({ ...values, nextRunAt: next })
        await changed()
        return `Scheduled "${name}" for ${bot.name}.`
      },
    }),
  }
}
