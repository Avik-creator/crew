import type { UIMessage } from "ai"

// Shapes returned by the Crew API

export type BotColor = "violet" | "blue" | "emerald" | "amber" | "rose" | "cyan" | "orange" | "pink"

export type Bot = {
  id: string
  name: string
  avatar: string
  color: BotColor
  job: string
  instructions: string
  model: string | null
  runsOn: "cloud" | "device"
  deviceId: string | null
  displayNumber: number
  status: "active" | "paused" | "hidden"
  // chief: the person's main assistant, which sets up the other bots
  role: "member" | "chief"
  wakeBudgetDaily: number
  serverIds: string[]
  directThreadId: string | null
}

export type Thread = {
  id: string
  kind: "direct" | "group" | "bot"
  name: string | null
  goal: string | null
  currentOwnerBotId: string | null
  lastMessagePreview: string
  lastMessageAt: string
  lastReadAt: string
  archived: boolean
  botIds: string[]
  unread: boolean
  working: string[]
  activeRuns: ActiveRun[]
}

export type StoredMessage = {
  id: string
  threadId: string
  role: "user" | "assistant" | "system"
  authorType: "user" | "bot" | "system"
  authorId: string | null
  parts: UIMessage["parts"]
  metadata: Record<string, unknown> | null
  addressedToBotId?: string | null
  createdAt: string
}

export type Connector = {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  transport: "http" | "stdio"
  url: string | null
  command: string | null
  args: string[] | null
  envKeys: string[] | null
  runOn: "cloud_computer" | "device" | null
  deviceId: string | null
  authMode: "oauth" | "token" | "none" | "first_party"
  isCustom: boolean
  needsSetup: boolean
  connection: {
    id: string
    status: "pending" | "active" | "error" | "revoked"
    error: string | null
    accountLabel: string | null
    toolCount: number | null
  } | null
}

export type ConnectorTemplate = {
  slug: string
  name: string
  description: string
  icon: string
  command?: string
  args?: string[]
  envKeys: string[]
  runOn?: "cloud_computer" | "device"
}

export type ConnectorTool = {
  name: string
  title: string
  description: string
  readOnly: boolean
  hard: boolean
  mode: "always_allow" | "always_ask" | null
}

export type Approval = {
  id: string
  botId: string
  botName: string
  botColor: BotColor
  threadId: string | null
  kind: "mcp" | "device" | "bot_message"
  toolName: string
  toolCallId: string | null
  title: string
  input: Record<string, unknown>
  hard: boolean
  status: "pending" | "approved" | "denied" | "expired"
  createdAt: string
}

export type Takeover = {
  id: string
  botId: string
  botName: string
  botColor: BotColor
  threadId: string | null
  reason: string
  instruction: string
  status: "pending" | "completed" | "skipped" | "expired"
  createdAt: string
}

export type Memory = {
  id: string
  botId: string | null
  key: string
  content: string
  category: string
  updatedAt: string
}

export type Schedule = {
  id: string
  botId: string
  name: string
  cron: string | null
  runAt: string | null
  timeZone: string
  prompt: string
  enabled: boolean
  lastRunAt: string | null
}

export type Device = {
  id: string
  name: string
  platform: string
  status: "online" | "offline"
  online: boolean
  lastSeenAt: string | null
  allowedPaths: string[]
}

export type CommandRule = { id: string; pattern: string; mode: "always_allow" | "always_ask" | "deny" }

export type Me = {
  user: { id: string; name: string; email: string; image: string | null }
  settings: {
    timeZone: string
    askBeforeBotMessages: boolean
    chiefDismissed: boolean
    notifications: { replies: boolean; approvals: boolean; botMessages: boolean }
  }
  computer: { status: "creating" | "running" | "paused" | "error" | "none"; error?: string | null; lastActiveAt?: string | null }
}

export type SearchResults = {
  messages: { id: string; threadId: string; authorType: string; authorId: string | null; snippet: string; createdAt: string }[]
  bots: { id: string; name: string; job: string; color: BotColor }[]
  threads: { id: string; name: string | null; kind: Thread["kind"] }[]
}

export type ActiveRun = { botId: string; triggerRunId: string }
