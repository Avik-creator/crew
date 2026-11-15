import { db, mcpServers, type McpServer } from "@crew/db"
import { randomToken } from "@crew/shared/node"
import { and, eq, or } from "drizzle-orm"

import { assertPublicUrl } from "./url-guard"

// Remote MCP servers from integrations.sh, an open registry of integration
// surfaces. Read once and kept in memory; a failed refresh keeps the last copy.

const SOURCE = "https://integrations.sh/api.json"
const TTL_MS = 6 * 60 * 60_000

export type RegistryAuth = "oauth" | "token" | "none" | "unknown"

export type RegistryEntry = {
  id: string
  name: string
  description: string
  domain: string
  url: string
  auth: RegistryAuth
  // How to send a pasted key, when the registry says (e.g. "Authorization: Bearer {key}")
  authHeader?: string
  categories: string[]
  // curated and Claude/ChatGPT directory listings rank above crawled ones
  rank: number
}

type Raw = {
  id: string
  kind: string
  name: string
  description?: string
  domain?: string
  connectUrl?: string
  categories?: string[]
  feeds?: string[]
  popularity?: number
  auth?: { kind?: string; header?: string }
}

let cache: { at: number; entries: RegistryEntry[] } | null = null
let loading: Promise<RegistryEntry[]> | null = null

const FEED_RANK: Record<string, number> = { curated: 4, claude: 3, openai: 2, discovered: 0 }

function toEntry(r: Raw): RegistryEntry | null {
  if (r.kind !== "mcp" || !r.connectUrl?.startsWith("https://")) return null
  const kind = r.auth?.kind
  const auth: RegistryAuth = kind === "oauth" || kind === "mixed" ? "oauth" : kind === "api_key" ? "token" : kind === "none" ? "none" : "unknown"
  const feedRank = Math.max(0, ...(r.feeds ?? []).map((f) => FEED_RANK[f] ?? 0))
  return {
    id: r.id,
    name: r.name,
    description: (r.description ?? "").slice(0, 300),
    domain: r.domain ?? "",
    url: r.connectUrl,
    auth,
    ...(r.auth?.header ? { authHeader: r.auth.header } : {}),
    categories: r.categories ?? [],
    rank: feedRank * 1000 + Math.min(r.popularity ?? 0, 999),
  }
}

async function load(): Promise<RegistryEntry[]> {
  const res = await fetch(SOURCE, { headers: { "user-agent": "crew-app" }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`integrations.sh answered ${res.status}`)
  const body = (await res.json()) as { data?: Raw[] }
  const entries = (body.data ?? []).map(toEntry).filter((e): e is RegistryEntry => !!e)
  entries.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name))
  return entries
}

export async function registryEntries(): Promise<RegistryEntry[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.entries
  loading ??= load()
    .then((entries) => {
      cache = { at: Date.now(), entries }
      return entries
    })
    .catch((err) => {
      if (cache) return cache.entries
      throw err
    })
    .finally(() => {
      loading = null
    })
  return loading
}

export async function registryEntry(id: string) {
  return (await registryEntries()).find((e) => e.id === id)
}

// Best matches first: name, then domain, then description and categories
export async function searchRegistry(query: string, limit = 40): Promise<RegistryEntry[]> {
  const entries = await registryEntries()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return entries.slice(0, limit)
  const scored: { e: RegistryEntry; score: number }[] = []
  for (const e of entries) {
    const name = e.name.toLowerCase()
    const domain = e.domain.toLowerCase()
    const rest = `${e.description} ${e.categories.join(" ")}`.toLowerCase()
    let score = 0
    for (const w of words) {
      if (name === w || domain.split(".")[0] === w) score += 100
      else if (name.startsWith(w)) score += 60
      else if (name.includes(w) || domain.includes(w)) score += 30
      else if (rest.includes(w)) score += 5
      else {
        score = 0
        break
      }
    }
    if (score) scored.push({ e, score: score * 10_000 + e.rank })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.e)
}

// For entries the registry doesn't label: an MCP server that wants sign-in
// answers 401 to a bare initialize. Redirects aren't followed.
export async function probeAuth(url: string): Promise<"oauth" | "none"> {
  await assertPublicUrl(url)
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "crew", version: "1" } },
      }),
      signal: AbortSignal.timeout(8_000),
    })
    await res.body?.cancel().catch(() => {})
    return res.status === 401 || res.status === 403 ? "oauth" : "none"
  } catch {
    return "oauth"
  }
}

// Listed in a curated, Claude or ChatGPT directory, not just crawled
export const isTrusted = (e: RegistryEntry) => e.rank >= 2000

export const serverSlug = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "server"}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`

// Adds a registry entry as one of the person's connectors, or returns the
// connector that already points at that URL. Nothing runs until they connect.
export async function installRegistryEntry(userId: string, entry: RegistryEntry): Promise<McpServer> {
  const [existing] = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.url, entry.url), or(eq(mcpServers.isCustom, false), eq(mcpServers.addedByUserId, userId))))
  if (existing) return existing
  await assertPublicUrl(entry.url)
  const authMode = entry.auth === "unknown" ? await probeAuth(entry.url) : entry.auth
  const [server] = await db
    .insert(mcpServers)
    .values({
      slug: serverSlug(entry.name),
      name: entry.name.slice(0, 50),
      description: entry.description.slice(0, 200),
      icon: `tile:${entry.name}`,
      transport: "http",
      url: entry.url,
      authMode,
      isCustom: true,
      addedByUserId: userId,
    })
    .returning()
  return server!
}
