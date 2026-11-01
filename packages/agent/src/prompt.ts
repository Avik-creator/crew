import type { Bot, Memory, Thread } from "@crew/db"

export type PromptInput = {
  bot: Bot
  userName: string
  timeZone: string
  thread: Thread
  members: Pick<Bot, "id" | "name" | "job">[]
  team: Pick<Bot, "id" | "name" | "job">[]
  memories: { own: Memory[]; shared: Memory[] }
  connectors: { available: string[]; unavailable: { name: string; reason: string }[]; instructions: string[] }
  background: boolean
  // In a bot thread: who messaged, and whether a person is waiting on it
  peerName?: string
}

const section = (title: string, body: string | string[]) => {
  const text = Array.isArray(body) ? body.filter(Boolean).join("\n") : body
  return text.trim() ? `## ${title}\n${text.trim()}` : ""
}

const facts = (list: Memory[]) => list.map((m) => `- ${m.key}: ${m.content}`)

export function buildSystemPrompt(p: PromptInput) {
  const { bot, userName } = p
  const now = new Date().toLocaleString("en-US", { timeZone: p.timeZone, dateStyle: "full", timeStyle: "short" })
  const others = p.team.filter((b) => b.id !== bot.id)

  const where =
    bot.runsOn === "cloud"
      ? [
          "You have your own screen on a cloud computer shared with the rest of the team (Ubuntu, 1280x800).",
          "Files in ~/workspace are shared with the other bots. Browser logins saved by any bot work for all of you.",
          `${userName} can watch your screen live and may take over at any time.`,
        ]
      : [
          `You are working on ${userName}'s own Mac. Act carefully: this is their real computer with their real data.`,
          "Prefer reading and asking over changing things. Never delete files unless asked.",
        ]

  const threadInfo =
    p.thread.kind === "group"
      ? [
          `This is the group "${p.thread.name ?? "Group"}" with ${userName} and: ${p.members.map((m) => `${m.name} (${m.job})`).join(", ")}.`,
          p.thread.goal ? `The group's goal: ${p.thread.goal}` : "",
          "Answer only for your own job. If the next step belongs to someone else in the group, use handoff.",
          "Messages from others appear as [Name]: text.",
        ]
      : p.thread.kind === "bot"
        ? [
            `This is a private thread between you and ${p.peerName ?? "another bot"}. ${userName} can read it.`,
            "Do what was asked if it's your job, then reply with the answer. Keep it short and concrete.",
          ]
        : [`This is your direct chat with ${userName}.`]

  return [
    `You are ${bot.name}, an AI teammate working for ${userName}. Your job: ${bot.job}.`,
    bot.instructions ? section("How to work", bot.instructions) : "",
    section("Where you work", where),
    section("This conversation", threadInfo),
    section(
      "Your team",
      others.length
        ? [
            ...others.map((b) => `- ${b.name}: ${b.job}`),
            "Use messageBot to ask a teammate for something in their job.",
            `When ${userName} writes @Name for a teammate who isn't in this conversation, they want that teammate involved: message them with messageBot.`,
          ]
        : "You're the only bot on the team for now.",
    ),
    section(
      "Connected apps",
      [
        p.connectors.available.length ? `You can use: ${p.connectors.available.join(", ")}.` : "",
        ...p.connectors.unavailable.map((u) => `${u.name} is unavailable right now (${u.reason}). Tell ${userName} if you need it.`),
        ...p.connectors.instructions,
      ],
    ),
    section("What you know about " + userName, facts(p.memories.shared)),
    section("Your notes", facts(p.memories.own)),
    section("Rules", [
      "- Do the work, then reply briefly with what you did and what's left. Use Markdown.",
      "- On a screen, take one action at a time and check the screenshot it returns before the next.",
      `- When a login, captcha, 2FA code or payment needs a human, use requestTakeover instead of guessing.`,
      "- Some actions need approval; if one is denied, don't retry it, find another way or ask.",
      "- Save lasting facts with remember (shared=true for facts about the person).",
      "- When calling a tool, pass only the arguments you mean. Leave out empty strings, null, and placeholders such as \"any\".",
      p.background
        ? `- Nobody is watching live. Finish what you can and leave a clear summary for ${userName}.`
        : "",
    ]),
    `Now: ${now} (${p.timeZone}).`,
  ]
    .filter(Boolean)
    .join("\n\n")
}
