import { ArrowRight, ChevronRight, Hand, Users } from "lucide-react"
import { useState } from "react"
import { Link } from "wouter"

import { useBots, useThreads } from "@/lib/queries"
import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { MentionChip, MentionList } from "./mention-chip"
import { describeTool, toolNameOf, ToolRow, type ToolPart } from "./tool-row"
import { Spinner } from "./ui/spinner"

// Tools that talk to people or teammates read as events, not work steps
export const EVENT_TOOLS = new Set(["messageBot", "handoff", "requestTakeover"])

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

// A run of work steps folds into one line that names the latest step
export function ActivityGroup({ parts, live }: { parts: ToolPart[]; live?: boolean }) {
  const [open, setOpen] = useState(false)
  if (parts.length === 1) return <ToolRow part={parts[0]!} />
  const last = parts[parts.length - 1]!
  const running = live && parts.some(isRunning)
  const failed = parts.filter((p) => p.state === "output-error").length
  const { text } = describeTool(toolNameOf(last), last.input)
  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group flex max-w-full items-center gap-2 rounded-md py-0.5 pr-2 text-left text-[12.5px] text-muted hover:text-fg"
      >
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-raised text-[10.5px] font-semibold tabular-nums text-muted">{parts.length}</span>
        <span className="shrink-0 font-medium text-fg/80">{running ? "Working" : "Worked"}</span>
        <span className="truncate text-faint">· {running ? text : `${parts.length} steps${failed ? `, ${failed} failed` : ""}`}</span>
        {running ? <Spinner className="size-3 shrink-0 text-faint" /> : null}
        <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="ml-2.5 mt-0.5 border-l border-line pl-3">
          {parts.map((p, i) => (
            <ToolRow key={p.toolCallId ?? i} part={p} />
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

// Marks where answers from other bots arrive in this conversation
export function BotMessagesDivider({ authors, threadId }: { authors: (Bot | undefined)[]; threadId?: string }) {
  return (
    <div className="mt-6 mb-2 flex items-center gap-3 px-5 text-[12.5px]">
      <span className="h-px flex-1 bg-line" />
      <span className="flex items-center gap-1.5 px-1">
        <span className="text-faint">Messages from</span>
        <span>
          <MentionList bots={authors} />
        </span>
        {threadId ? (
          <Link href={`/t/${threadId}`} className="grid size-5 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg" aria-label="Open their conversation">
            <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
