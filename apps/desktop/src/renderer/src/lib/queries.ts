import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

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
export const useMessages = (threadId: string) =>
  useQuery({ queryKey: keys.messages(threadId), queryFn: () => api<StoredMessage[]>(`/threads/${threadId}/messages?limit=100`) })
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
