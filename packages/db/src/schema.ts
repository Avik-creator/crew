import { relations, sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { nanoid } from "nanoid"

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid())
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

// ── Better Auth ──────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
)

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

// ── App ──────────────────────────────────────────────────────────────────────

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull().default("UTC"),
  // Ask before a bot messages another bot on your behalf
  askBeforeBotMessages: boolean("ask_before_bot_messages").notNull().default(false),
  notifications: jsonb("notifications")
    .$type<{ replies: boolean; approvals: boolean; botMessages: boolean }>()
    .notNull()
    .default({ replies: true, approvals: true, botMessages: true }),
  updatedAt: updatedAt(),
})

export const computers = pgTable("computers", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"e2b" | "daytona">().notNull(),
  sandboxId: text("sandbox_id"),
  templateId: text("template_id"),
  status: text("status")
    .$type<"creating" | "running" | "paused" | "error" | "none">()
    .notNull()
    .default("none"),
  error: text("error"),
  trafficToken: text("traffic_token"), // encrypted
  resolution: text("resolution").notNull().default("1280x800"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  lastResumedAt: timestamp("last_resumed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version"),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").$type<"online" | "offline">().notNull().default("offline"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    capabilities: jsonb("capabilities")
      .$type<{ shell: boolean; files: boolean; screen: boolean; input: boolean; stdioMcp: boolean }>()
      .notNull()
      .default({ shell: false, files: false, screen: false, input: false, stdioMcp: false }),
    allowedPaths: text("allowed_paths").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [index("devices_user_idx").on(t.userId)],
)

export const bots = pgTable(
  "bots",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    avatar: text("avatar").notNull().default(""),
    color: text("color").notNull().default("violet"),
    job: text("job").notNull(),
    instructions: text("instructions").notNull().default(""),
    model: text("model"),
    runsOn: text("runs_on").$type<"cloud" | "device">().notNull().default("cloud"),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
    // Display n on the shared computer (:n); kept even in local mode
    displayNumber: integer("display_number").notNull(),
    status: text("status").$type<"active" | "paused" | "hidden">().notNull().default("active"),
    wakeBudgetDaily: integer("wake_budget_daily").notNull().default(50),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bots_user_idx").on(t.userId),
    uniqueIndex("bots_user_display_idx").on(t.userId, t.displayNumber),
  ],
)

export const deviceCommandRules = pgTable("device_command_rules", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  deviceId: text("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  mode: text("mode").$type<"always_allow" | "always_ask" | "deny">().notNull(),
  createdAt: createdAt(),
})

export const deviceActions = pgTable(
  "device_actions",
  {
    id: id(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    botId: text("bot_id"),
    tool: text("tool").notNull(),
    inputSummary: text("input_summary").notNull(),
    decision: text("decision").$type<"auto" | "approved" | "denied">().notNull(),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("device_actions_device_idx").on(t.deviceId, t.createdAt)],
)

export const threads = pgTable(
  "threads",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"direct" | "group" | "bot">().notNull(),
    name: text("name"),
    goal: text("goal"),
    currentOwnerBotId: text("current_owner_bot_id"),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    // Last time the person opened it, for unread dots
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("threads_user_idx").on(t.userId, t.lastMessageAt)],
)

export const threadMembers = pgTable(
  "thread_members",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.botId] }), index("thread_members_bot_idx").on(t.botId)],
)

export const messages = pgTable(
  "messages",
  {
    id: id(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    authorType: text("author_type").$type<"user" | "bot" | "system">().notNull(),
    authorId: text("author_id"),
    // AI SDK UIMessage parts
    parts: jsonb("parts").$type<unknown[]>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    addressedToBotId: text("addressed_to_bot_id"),
    chainId: text("chain_id"),
    hop: integer("hop").notNull().default(0),
    runId: text("run_id"),
    // Plain text for search and previews
    text: text("text").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_thread_idx").on(t.threadId, t.createdAt),
    index("messages_text_idx").using("gin", sql`to_tsvector('english', ${t.text})`),
  ],
)

export const runs = pgTable(
  "runs",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    trigger: text("trigger")
      .$type<"chat" | "wake" | "schedule" | "group" | "approval" | "takeover" | "handoff">()
      .notNull(),
    status: text("status")
      .$type<"queued" | "running" | "waiting" | "completed" | "failed" | "cancelled">()
      .notNull()
      .default("queued"),
    triggerRunId: text("trigger_run_id"),
    chainId: text("chain_id"),
    hop: integer("hop").notNull().default(0),
    usage: jsonb("usage").$type<{ inputTokens?: number; outputTokens?: number; steps?: number }>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("runs_bot_idx").on(t.botId, t.startedAt), index("runs_user_idx").on(t.userId, t.startedAt)],
)

export const memories = pgTable(
  "memories",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // null = a shared fact about the person every bot can read
    botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull().default("general"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("memories_bot_key_idx").on(t.userId, t.botId, t.key)],
)

export const mcpServers = pgTable("mcp_servers", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default(""),
  transport: text("transport").$type<"http" | "stdio">().notNull(),
  url: text("url"),
  command: text("command"),
  args: text("args").array(),
  envKeys: text("env_keys").array(),
  runOn: text("run_on").$type<"cloud_computer" | "device">(),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
  authMode: text("auth_mode").$type<"oauth" | "token" | "none" | "first_party">().notNull(),
  staticClientEnv: text("static_client_env"),
  scopes: text("scopes"),
  authParams: jsonb("auth_params").$type<Record<string, string>>(),
  hardApprovalTools: text("hard_approval_tools").array(),
  // Tools that ask for approval by default (writes); others run freely
  defaultAskTools: text("default_ask_tools").array(),
  isCustom: boolean("is_custom").notNull().default(false),
  addedByUserId: text("added_by_user_id").references(() => user.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
})

export const connections = pgTable(
  "connections",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    status: text("status").$type<"pending" | "active" | "error" | "revoked">().notNull().default("pending"),
    error: text("error"),
    clientInfo: text("client_info"), // encrypted json
    tokens: text("tokens"), // encrypted json
    codeVerifier: text("code_verifier"), // encrypted
    state: text("state"),
    env: text("env"), // encrypted json, cloud stdio only
    bridgePort: integer("bridge_port"),
    bridgeToken: text("bridge_token"), // encrypted
    scopes: text("scopes"),
    accountLabel: text("account_label"),
    // Authorization server discovered during the OAuth flow
    authServer: jsonb("auth_server").$type<{ issuer?: string; authorizationServerUrl: string; tokenEndpoint: string }>(),
    // Full MCP tool definitions so turns skip tools/list
    toolsCache: jsonb("tools_cache").$type<CachedTool[]>(),
    toolsCachedAt: timestamp("tools_cached_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("connections_user_server_idx").on(t.userId, t.serverId),
    index("connections_state_idx").on(t.state),
  ],
)

export const botServers = pgTable(
  "bot_servers",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.botId, t.serverId] })],
)

export const toolPrefs = pgTable(
  "tool_prefs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    mode: text("mode").$type<"always_allow" | "always_ask">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serverId, t.toolName] })],
)

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    // mcp: a connector tool; device: a command on the Mac; bot_message: bot-to-bot
    kind: text("kind").$type<"mcp" | "device" | "bot_message">().notNull(),
    serverId: text("server_id"),
    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id"),
    title: text("title").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    hard: boolean("hard").notNull().default(false),
    status: text("status")
      .$type<"pending" | "approved" | "denied" | "expired">()
      .notNull()
      .default("pending"),
    // Set when the person picked "always allow" with the decision
    remember: boolean("remember").notNull().default(false),
    // The run that waited gave up; a decision now starts a new turn
    orphaned: boolean("orphaned").notNull().default(false),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_user_idx").on(t.userId, t.status)],
)

export const takeovers = pgTable(
  "takeovers",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    threadId: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    instruction: text("instruction").notNull(),
    status: text("status")
      .$type<"pending" | "completed" | "skipped" | "expired">()
      .notNull()
      .default("pending"),
    note: text("note"),
    orphaned: boolean("orphaned").notNull().default(false),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("takeovers_user_idx").on(t.userId, t.status)],
)

export const browserSessions = pgTable(
  "browser_sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    storageStatePath: text("storage_state_path").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("browser_sessions_user_domain_idx").on(t.userId, t.domain)],
)

export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cron: text("cron"),
    runAt: timestamp("run_at", { withTimezone: true }),
    timeZone: text("time_zone").notNull().default("UTC"),
    prompt: text("prompt").notNull(),
    triggerScheduleId: text("trigger_schedule_id"),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("schedules_user_idx").on(t.userId)],
)

// ── Relations (for db.query) ────────────────────────────────────────────────

export const botsRelations = relations(bots, ({ one, many }) => ({
  device: one(devices, { fields: [bots.deviceId], references: [devices.id] }),
  memberships: many(threadMembers),
}))

export const threadsRelations = relations(threads, ({ many }) => ({
  members: many(threadMembers),
  messages: many(messages),
}))

export const threadMembersRelations = relations(threadMembers, ({ one }) => ({
  thread: one(threads, { fields: [threadMembers.threadId], references: [threads.id] }),
  bot: one(bots, { fields: [threadMembers.botId], references: [bots.id] }),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  thread: one(threads, { fields: [messages.threadId], references: [threads.id] }),
}))

export const connectionsRelations = relations(connections, ({ one }) => ({
  server: one(mcpServers, { fields: [connections.serverId], references: [mcpServers.id] }),
}))

export type CachedTool = {
  name: string
  title?: string
  description?: string
  inputSchema: { type?: unknown; properties?: Record<string, unknown>; [k: string]: unknown }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown }
}

export type Bot = typeof bots.$inferSelect
export type Thread = typeof threads.$inferSelect
export type Message = typeof messages.$inferSelect
export type Run = typeof runs.$inferSelect
export type Memory = typeof memories.$inferSelect
export type McpServer = typeof mcpServers.$inferSelect
export type Connection = typeof connections.$inferSelect
export type Approval = typeof approvals.$inferSelect
export type Takeover = typeof takeovers.$inferSelect
export type Computer = typeof computers.$inferSelect
export type Device = typeof devices.$inferSelect
export type Schedule = typeof schedules.$inferSelect
