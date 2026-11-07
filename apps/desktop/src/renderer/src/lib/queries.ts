import { infiniteQueryOptions, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query"

import { api } from "./api"
import type {
  Approval,
  Bot,
  CommandRule,
  Connector,
  ConnectorTemplate,
  ConnectorTool,
  Device,
  Me,
  Memory,
  Schedule,
  StoredMessage,
  Takeover,
  Thread,
} from "./types"

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
})

export const keys = {
  me: ["me"] as const,
  bots: ["bots"] as const,
  threads: ["threads"] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  connectors: ["connectors"] as const,
  tools: (serverId: string) => ["tools", serverId] as const,
  approvals: ["approvals"] as const,
  takeovers: ["takeovers"] as const,
  memories: ["memories"] as const,
  schedules: ["schedules"] as const,
  devices: ["devices"] as const,
  rules: (deviceId: string) => ["rules", deviceId] as const,
}

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: () => api<Me>("/me") })
export const useBots = () => useQuery({ queryKey: keys.bots, queryFn: () => api<Bot[]>("/bots") })
export const useThreads = () => useQuery({ queryKey: keys.threads, queryFn: () => api<Thread[]>("/threads") })

// A chat loads its newest 100 messages, then older pages on request. The
// cache holds the pages newest first and stays for half an hour, so a chat
// opened again shows at once while a fresh copy loads behind it.
const MESSAGE_PAGE = 100
export const messagesQuery = (threadId: string) =>
  infiniteQueryOptions({
    queryKey: keys.messages(threadId),
    queryFn: ({ pageParam }) =>
      api<StoredMessage[]>(`/threads/${threadId}/messages?limit=${MESSAGE_PAGE}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: null as string | null,
    // A full page may have more before it; the next page ends where this one starts
    getNextPageParam: (page) => (page.length < MESSAGE_PAGE ? null : (page[0]?.createdAt ?? null)),
    gcTime: 30 * 60_000,
  })
export const useMessages = (threadId: string) =>
  useInfiniteQuery({ ...messagesQuery(threadId), select: (data) => [...data.pages].reverse().flat() })
// Starts loading a chat before it's opened, e.g. when the pointer is on it
export const prefetchMessages = (threadId: string) => void queryClient.prefetchInfiniteQuery(messagesQuery(threadId))
// Changes the newest page in place: a draft added while sending, then swapped for the saved copy
export function editNewestMessages(threadId: string, fn: (list: StoredMessage[]) => StoredMessage[]) {
  queryClient.setQueryData<InfiniteData<StoredMessage[], string | null>>(keys.messages(threadId), (old) =>
    old ? { ...old, pages: [fn(old.pages[0] ?? []), ...old.pages.slice(1)] } : { pages: [fn([])], pageParams: [null] },
  )
}

// Saved messages an event named go into the cache one by one: a message
// already there is replaced where it is, a new one goes in by time. Messages
// named while a request is out wait and go together in the next one.
const waiting = new Map<string, Set<string>>()
const pulls = new Map<string, Promise<void>>()

// Resolves once every message named so far for this chat is in the cache
export const messagesPulled = (threadId: string) => pulls.get(threadId) ?? Promise.resolve()

export function pullMessages(threadId: string, ids: string[]) {
  const key = keys.messages(threadId)
  // A chat that isn't loaded gets everything when it's opened
  if (!queryClient.getQueryData(key)) {
    if (queryClient.isFetching({ queryKey: key })) void queryClient.invalidateQueries({ queryKey: key })
    return messagesPulled(threadId)
  }
  const next = waiting.get(threadId)
  if (next) {
    for (const id of ids) next.add(id)
    return messagesPulled(threadId)
  }
  waiting.set(threadId, new Set(ids))
  const pull = messagesPulled(threadId).then(async () => {
    const want = [...(waiting.get(threadId) ?? [])]
    waiting.delete(threadId)
    // A full load already out may have left before these were saved: let it land first
    await whenIdle(key)
    try {
      mergeMessages(threadId, await api<StoredMessage[]>(`/threads/${threadId}/messages?ids=${want.map(encodeURIComponent).join(",")}`))
    } catch {
      await queryClient.invalidateQueries({ queryKey: key })
    }
  })
  pulls.set(threadId, pull)
  void pull.finally(() => pulls.get(threadId) === pull && pulls.delete(threadId))
  return pull
}

function whenIdle(key: readonly unknown[]) {
  if (!queryClient.isFetching({ queryKey: key })) return Promise.resolve()
  return new Promise<void>((done) => {
    const stop = queryClient.getQueryCache().subscribe(() => {
      if (queryClient.isFetching({ queryKey: key })) return
      stop()
      done()
    })
  })
}

const firstText = (m: StoredMessage) => (m.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text ?? ""

function mergeMessages(threadId: string, rows: StoredMessage[]) {
  queryClient.setQueryData<InfiniteData<StoredMessage[], string | null>>(keys.messages(threadId), (old) => {
    if (!old) return old
    let pages = old.pages
    for (const row of rows) {
      const at = pages.findIndex((page) => page.some((m) => m.id === row.id))
      if (at !== -1) {
        pages = pages.map((page, i) => (i === at ? page.map((m) => (m.id === row.id ? row : m)) : page))
        continue
      }
      // Your own message can come back before the send answers: it takes its draft's place
      const newest = [...(pages[0] ?? [])]
      const draft = row.authorType === "user" ? newest.findIndex((m) => m.id.startsWith("draft-") && firstText(m) === firstText(row)) : -1
      if (draft !== -1) newest.splice(draft, 1)
      let i = newest.length
      while (i > 0 && newest[i - 1]!.createdAt > row.createdAt) i--
      newest.splice(i, 0, row)
      pages = [newest, ...pages.slice(1)]
    }
    return { ...old, pages }
  })
}

export const useConnectors = () =>
  useQuery({ queryKey: keys.connectors, queryFn: () => api<{ servers: Connector[]; templates: ConnectorTemplate[] }>("/connectors") })
export const useConnectorTools = (serverId: string | null) =>
  useQuery({
    queryKey: keys.tools(serverId ?? ""),
    queryFn: () => api<ConnectorTool[]>(`/connectors/${serverId}/tools`),
    enabled: !!serverId,
  })
export const useApprovals = () => useQuery({ queryKey: keys.approvals, queryFn: () => api<Approval[]>("/inbox/approvals") })
export const useTakeovers = () => useQuery({ queryKey: keys.takeovers, queryFn: () => api<Takeover[]>("/inbox/takeovers") })
export const useMemories = () => useQuery({ queryKey: keys.memories, queryFn: () => api<Memory[]>("/memories") })
export const useSchedules = () => useQuery({ queryKey: keys.schedules, queryFn: () => api<Schedule[]>("/schedules") })
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<Device[]>("/devices") })
export const useRules = (deviceId: string | null) =>
  useQuery({ queryKey: keys.rules(deviceId ?? ""), queryFn: () => api<CommandRule[]>(`/devices/${deviceId}/rules`), enabled: !!deviceId })

// A mutation that refreshes the given queries when it succeeds
export function useAction<TInput, TOutput = unknown>(
  fn: (input: TInput) => Promise<TOutput>,
  invalidate: (readonly unknown[])[] = [],
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key }))),
  })
}
