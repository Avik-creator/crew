import { ArrowRight, ChevronRight, Hand, Users } from "lucide-react"
import { useState } from "react"
import { Link } from "wouter"

import { useBots, useThreads } from "@/lib/queries"
import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { BotAvatar, GroupAvatar } from "./bot-avatar"
import { MentionChip, MentionList } from "./mention-chip"
import { toolNameOf, ToolRow, type ToolPart } from "./tool-row"
import { Spinner } from "./ui/spinner"

// Tools that talk to people or teammates read as events, not work steps
export const EVENT_TOOLS = new Set(["messageBot", "handoff", "requestTakeover", "createBot", "updateBot", "createGroup"])
const TEAM_TOOLS = new Set(["createBot", "updateBot", "createGroup"])

const isRunning = (p: ToolPart) => p.state === "input-streaming" || p.state === "input-available" || p.state === "approval-responded"

const findBot = (bots: Bot[] | undefined, name: unknown) => {
  const wanted = String(name ?? "").trim().replace(/^@/, "").toLowerCase()
  return bots?.find((b) => b.name.toLowerCase() === wanted)
}

// The private thread two bots share, if it exists yet
export function usePairThread(a: string | undefined, b: string | undefined) {
  const threads = useThreads()
  if (!a || !b) return undefined
  return threads.data?.find((t) => t.kind === "bot" && t.botIds.includes(a) && t.botIds.includes(b))
}

// While live only the newest steps show, so a long run doesn't push the reply away
const LIVE_STEPS = 6

// A run of work steps, after Rakazo's tool disclosure: open while the bot is
// working, folded to "Done · N steps" once it's finished, unless toggled.
// working: the turn goes on after these steps, so the group reads as still busy
export function ActivityGroup({ parts, live, working }: { parts: ToolPart[]; live?: boolean; working?: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  if (parts.length === 1) return <ToolRow part={parts[0]!} />
  const running = (live && parts.some(isRunning)) || !!working
  const open = toggled ?? running
  const failed = parts.filter((p) => p.state === "output-error").length
  const shown = running && toggled === null ? parts.slice(-LIVE_STEPS) : parts
  const hidden = parts.length - shown.length
  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setToggled(!open)}
        aria-expanded={open}
        className={cn(
          "flex min-h-6 w-fit items-center gap-1 rounded-md py-0.5 pr-1.5 text-[13px] font-medium transition-colors",
          running ? "text-fg/75" : "text-muted hover:text-fg/75",
        )}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className={cn(running && "animate-pulse-soft")}>{running ? "Working…" : "Done"}</span>
        <span className="font-normal text-faint">
          · {parts.length} steps{failed ? `, ${failed} failed` : ""}
        </span>
      </button>
      {open ? (
        <div className="ml-[7px] mt-0.5 border-l border-line pl-3">
          {hidden ? <p className="text-[12px] leading-5 text-faint">+{hidden} earlier steps</p> : null}
          {shown.map((p, i) => (
            <ToolRow key={p.toolCallId ?? i} part={p} step />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// One bot reaching another: who, what was said, and where the thread lives
export function BotEvent({ part, fromBotId }: { part: ToolPart; fromBotId?: string }) {
  const bots = useBots()
  const [open, setOpen] = useState(false)
  const name = toolNameOf(part)
  const input = (part.input ?? {}) as { to?: string; message?: string; note?: string; reason?: string; instruction?: string }
  const target = findBot(bots.data, input.to)
  const pair = usePairThread(fromBotId, target?.id)
  if (TEAM_TOOLS.has(name)) return <TeamEvent part={part} />
  const output = typeof part.output === "string" ? part.output : ""
  const failed = part.state === "output-error" || (part.state === "output-available" && !!output && !/^(Sent|Handed off|Asked)/.test(output))
  const running = isRunning(part)

  if (name === "requestTakeover") {
    return (
      <p className="my-1 flex items-center gap-2 text-[12.5px] text-muted">
        <Hand className="size-3.5 shrink-0 text-warn" />
        Asked you to take over{input.reason ? <span className="truncate text-faint">· {input.reason}</span> : null}
      </p>
    )
  }

  const body = name === "handoff" ? input.note : input.message
  const status = running ? "Sending…" : failed ? (part.errorText ?? output ?? "Not sent") : name === "handoff" ? "Handed off" : "Delivered"

  return (
    <div className="my-1.5 w-full max-w-[30rem] overflow-hidden rounded-2xl border border-line bg-bg">
      <div className="flex items-center gap-2 px-3 pt-2 text-[12.5px]">
        {name === "handoff" ? <Users className="size-3.5 shrink-0 text-muted" /> : <ArrowRight className="size-3.5 shrink-0 text-muted" />}
        <span className="text-muted">{name === "handoff" ? "Handed off to" : "Messaged"}</span>
        {target ? <MentionChip bot={target} /> : <span className="font-medium">{input.to ?? "…"}</span>}
        <span className={cn("ml-auto flex shrink-0 items-center gap-1 text-[11.5px]", failed ? "text-danger" : "text-faint")}>
          {running ? <Spinner className="size-3" /> : null}
          <span className="max-w-48 truncate">{status}</span>
        </span>
      </div>
      {body ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn("selectable block w-full px-3 pb-2 pt-1 text-left text-[13px] leading-relaxed text-fg/90", !open && "line-clamp-2")}
          title={open ? undefined : "Show all"}
        >
          {body}
        </button>
      ) : (
        <div className="h-2" />
      )}
      {pair && name === "messageBot" ? (
        <Link href={`/t/${pair.id}`} className="flex items-center gap-1 border-t border-line px-3 py-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
          Open their conversation <ChevronRight className="size-3" />
        </Link>
      ) : null}
    </div>
  )
}

// The main assistant changing the team: a new bot, an edit, or a new group
function TeamEvent({ part }: { part: ToolPart }) {
  const bots = useBots()
  const threads = useThreads()
  const name = toolNameOf(part)
  const input = (part.input ?? {}) as { name?: string; newName?: string; job?: string; members?: string[]; goal?: string; status?: string }
  const output = typeof part.output === "string" ? part.output : ""
  const running = isRunning(part)
  const failed = part.state === "output-error" || (part.state === "output-available" && !/^(Created|Updated)/.test(output))
  const bot = findBot(bots.data, input.newName ?? input.name)
  const group = name === "createGroup" ? threads.data?.find((t) => t.kind === "group" && t.name?.toLowerCase() === input.name?.toLowerCase()) : undefined
  const members = (input.members ?? []).map((m) => findBot(bots.data, m))

  const verb = name === "createBot" ? "New bot" : name === "updateBot" ? "Updated" : "New group"
  const href = name === "createGroup" ? (group ? `/t/${group.id}` : undefined) : bot?.directThreadId ? `/t/${bot.directThreadId}` : undefined

  return (
    <div className={cn("my-1.5 w-full max-w-[30rem] overflow-hidden rounded-2xl border bg-bg", failed ? "border-danger/30" : "border-line")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        {name === "createGroup" ? (
          <GroupAvatar bots={members} size="lg" />
        ) : (
          <BotAvatar bot={bot ?? { name: input.name ?? "?", color: "violet", avatar: "" }} size="lg" working={running} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-faint">{verb}</p>
          <p className="truncate text-[13.5px] font-semibold">{name === "createGroup" ? input.name : (bot?.name ?? input.newName ?? input.name)}</p>
          <p className="truncate text-[12px] text-muted">
            {name === "createGroup"
              ? members.map((b, i) => b?.name ?? input.members?.[i]).join(", ")
              : name === "updateBot"
                ? [input.job, input.status === "paused" ? "Paused" : input.status === "active" ? "Resumed" : ""].filter(Boolean).join(" · ") || "Settings changed"
                : (input.job ?? bot?.job)}
          </p>
        </div>
        {running ? <Spinner className="size-3.5 text-faint" /> : null}
      </div>
      {failed ? (
        <p className="border-t border-line px-3 py-1.5 text-[12px] text-danger">{part.errorText ?? output}</p>
      ) : href && !running ? (
        <Link href={href} className="flex items-center gap-1 border-t border-line px-3 py-1.5 text-[11.5px] text-muted hover:bg-hover hover:text-fg">
          {name === "createGroup" ? "Open the group" : `Chat with ${bot?.name ?? "it"}`} <ChevronRight className="size-3" />
        </Link>
      ) : null}
    </div>
  )
}

// Where answers from other bots arrive. They're for the bot that asked, which
// sums them up, so the person sees only who replied.
export function BotMessagesDivider({ authors }: { authors: (Bot | undefined)[] }) {
  return (
    <div className="mt-4 mb-1 flex items-center gap-3 text-[12.5px]">
      <span className="h-px flex-1 bg-line" />
      <span className="flex items-center gap-1.5 px-1">
        <MentionList bots={authors} />
        <span className="text-faint">replied</span>
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
