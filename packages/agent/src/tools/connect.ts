import { botServers, connections, db, mcpServers } from "@crew/db"
import { installRegistryEntry, isTrusted, searchRegistry } from "@crew/mcp"
import { tool, type Tool } from "ai"
import { and, eq, or } from "drizzle-orm"
import { z } from "zod"

import type { TurnContext } from "../context"

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

// What the chat shows as a card with a Connect button
export type ConnectRequest = { serverId: string; name: string; icon: string; threadId: string; status: "needs_connect" | "connected" }

// Lets a bot ask the person to connect an app it needs (Slack, HubSpot...).
// It finds the app among Crew's connectors or in the integrations.sh list,
// gives it to this bot, and posts a card; signing in stays with the person.
export function connectTools(ctx: TurnContext): Record<string, Tool> {
  return {
    requestConnection: tool({
      description:
        "Ask the person to connect an app you need for this task (e.g. Slack, HubSpot, Stripe, Figma). " +
        "A card with a Connect button appears in the chat. After calling this, stop and tell them what you'll do once it's connected.",
      inputSchema: z.object({
        app: z.string().min(1).max(60).describe("The app's name, e.g. 'Slack'"),
        why: z.string().max(300).describe("One sentence on what you need it for"),
      }),
      execute: async ({ app }) => {
        const wanted = norm(app)
        const known = await db
          .select()
          .from(mcpServers)
          .where(or(eq(mcpServers.isCustom, false), eq(mcpServers.addedByUserId, ctx.userId)))
        let server = known.find((s) => norm(s.name) === wanted || norm(s.slug).startsWith(wanted))
        if (!server) {
          const [hit] = (await searchRegistry(app, 5).catch(() => [])).filter(isTrusted)
          if (!hit || !norm(hit.name).includes(wanted)) {
            return { error: `Couldn't find ${app} in the integrations list. Ask the person to add it from Connections → Browse integrations or by URL.` }
          }
          server = await installRegistryEntry(ctx.userId, hit)
        }
        await db.insert(botServers).values({ botId: ctx.bot.id, serverId: server.id }).onConflictDoNothing()
        const [conn] = await db
          .select({ status: connections.status })
          .from(connections)
          .where(and(eq(connections.userId, ctx.userId), eq(connections.serverId, server.id)))
        await ctx.events.emit(ctx.userId, { type: "team.updated" })
        const out: ConnectRequest = {
          serverId: server.id,
          name: server.name,
          icon: server.icon,
          threadId: ctx.thread.id,
          status: conn?.status === "active" ? "connected" : "needs_connect",
        }
        return out
      },
    }),
  }
}
