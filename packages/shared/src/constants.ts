// Limits that keep bots from looping, flooding or running forever. One place,
// so the server, the tasks and the app agree on them.
export const LIMITS = {
  // Steps the model may take in one turn; desktop work is one small action per step
  maxStepsPerTurn: 50,
  // How many times a chain of bot-to-bot messages or in-group handoffs may bounce
  maxHops: 6,
  // Wakes one bot may have per day unless its owner raises it
  defaultWakeBudgetDaily: 50,
  // Bots in a group chat
  groupMinBots: 2,
  groupMaxBots: 6,
  // Characters of command output or file content handed to the model
  maxToolTextLength: 20_000,
  // Messages of history a turn reads
  historyMessages: 40,
  // How long a live tool call waits for the person to approve or take over
  approvalWaitMs: 15 * 60_000,
  // Idle time before a cloud computer pauses itself
  computerIdleMs: 10 * 60_000,
  // Forced pause/resume before E2B's continuous-runtime cap (24h on Pro)
  computerMaxContinuousMs: 23 * 60 * 60_000,
} as const

// Ports on the cloud computer: display n serves VNC on 5900+n and noVNC on 6080+n,
// stdio MCP bridge n listens on 7100+n
export const PORTS = {
  vnc: (display: number) => 5900 + display,
  novnc: (display: number) => 6080 + display,
  bridge: (index: number) => 7100 + index,
} as const

export const CLOUD_SCREEN = { width: 1280, height: 800 } as const

// The app's custom protocol, used for auth and connector callbacks
export const DEEP_LINK_SCHEME = "crew"

export const BOT_COLOR_NAMES = ["violet", "blue", "emerald", "amber", "rose", "cyan", "orange", "pink"] as const
export type BotColorName = (typeof BOT_COLOR_NAMES)[number]

export const BOT_NAME_MAX = 50
export const BOT_JOB_MAX = 100
export const BOT_INSTRUCTIONS_MAX = 4000

// Trigger.dev ids shared by the tasks, the server and the app
export const TRIGGER = {
  botTurn: "bot-turn",
  scheduledTurn: "scheduled-turn",
  scheduledTurnOnce: "scheduled-turn-once",
  // Realtime stream carrying a turn's AI SDK UI message chunks
  uiStream: "ui",
} as const
