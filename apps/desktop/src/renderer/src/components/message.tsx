import type { UIMessage } from "ai"
import { ArrowRight, CalendarClock, ChevronRight, TriangleAlert } from "lucide-react"
import { memo, useState } from "react"

import type { Approval, Bot } from "@/lib/types"
import { chatStamp, cn } from "@/lib/utils"

import { ActivityGroup, BotEvent, EVENT_TOOLS } from "./activity"
import { BotAvatar, colorOf } from "./bot-avatar"
import { ApprovalCard } from "./inbox-cards"
import { Markdown } from "./markdown"
import { MentionChip } from "./mention-chip"
import { toolNameOf, ToolRow, type ToolPart } from "./tool-row"

type Author = { kind: "user"; name: string } | { kind: "bot"; bot: Bot | undefined } | { kind: "system" }

// direct: a person and one bot, so bot messages skip names. group and bot
// threads have several speakers, so each run of messages starts with a name.
export type ChatLayout = "direct" | "group" | "bot"

export type MessageProps = {
  id: string
  author: Author
  parts: UIMessage["parts"]
  metadata?: Record<string, unknown> | null
  createdAt?: string
  streaming?: boolean
  approvals?: Approval[]
  layout: ChatLayout
  // Same author as the message before, so no name or avatar
  grouped?: boolean
  // Time label above the message, for the first one after a gap
  showStamp?: boolean
  // In bot threads and relayed answers: who the message is for
  addressedTo?: Bot
}

type Segment =
  | { kind: "text"; text: string; index: number }
  | { kind: "reasoning"; text: string; index: number }
  | { kind: "image"; url: string; index: number }
  | { kind: "tools"; parts: ToolPart[] }
  | { kind: "event"; part: ToolPart }
  | { kind: "approval"; part: ToolPart; approval: Approval }

// Groups a message's parts into what the person sees: text bubbles, folded
// runs of work steps, and events like a message to another bot
function segment(parts: UIMessage["parts"], approvals: Approval[] | undefined): Segment[] {
  const out: Segment[] = []
  parts.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text) out.push({ kind: "text", text: part.text, index })
    } else if (part.type === "reasoning") {
      if (part.text.trim()) out.push({ kind: "reasoning", text: part.text, index })
    } else if (part.type === "file" && part.mediaType.startsWith("image/")) {
      out.push({ kind: "image", url: part.url, index })
    } else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const tp = part as unknown as ToolPart
      const approval = tp.state === "approval-requested" ? approvals?.find((a) => a.toolCallId === tp.approval?.id) : undefined
      if (approval) out.push({ kind: "approval", part: tp, approval })
      else if (EVENT_TOOLS.has(toolNameOf(tp))) out.push({ kind: "event", part: tp })
      else {
        const last = out[out.length - 1]
        if (last?.kind === "tools") last.parts.push(tp)
        else out.push({ kind: "tools", parts: [tp] })
      }
    }
  })
  return out
}

function Reasoning({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-0.5">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        <span className={cn(streaming && "animate-pulse-soft")}>{streaming ? "Thinking…" : "Thought it through"}</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? <p className="selectable mt-1 ml-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-[12.5px] text-muted">{text}</p> : null}
    </div>
  )
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[18px] bg-raised px-3.5 py-3", className)} role="status" aria-label="Typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 rounded-full bg-faint animate-typing" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  )
}

function SystemNote({ text, scheduleName }: { text: string; scheduleName?: string }) {
  if (scheduleName) {
    return (
      <div className="my-4 flex justify-center px-5">
        <div className="max-w-lg rounded-2xl border border-line px-3.5 py-2.5 text-[12.5px]">
          <p className="flex items-center gap-1.5 font-medium text-muted">
            <CalendarClock className="size-3.5" /> Scheduled · {scheduleName}
          </p>
          <p className="selectable mt-1 text-fg">{text}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="my-4 flex justify-center px-5">
      <p className="flex max-w-xl items-start gap-1.5 rounded-2xl bg-danger/8 px-3 py-1.5 text-[12px] text-danger">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> <span className="selectable">{text}</span>
      </p>
    </div>
  )
}

export const Message = memo(function Message({ author, parts, metadata, createdAt, streaming, approvals, layout, grouped, showStamp, addressedTo }: MessageProps) {
  const meta = (metadata ?? {}) as { via?: string; scheduleName?: string }

  if (author.kind === "system") {
    return <SystemNote text={parts.map((p) => (p.type === "text" ? p.text : "")).join("")} scheduleName={meta.scheduleName} />
  }

  const mine = author.kind === "user"
  const bot = author.kind === "bot" ? author.bot : undefined
  const relayed = meta.via === "bot_message"
  const segments = segment(parts, approvals)
  const lastText = parts.length - 1
  const named = !mine && !grouped && (layout !== "direct" || relayed)
  const busy = streaming && !segments.length

  // A turn in progress with nothing on screen yet shows typing dots; one with
  // only finished steps shows them under the steps
  const settled = segments.every((s) => s.kind !== "tools" || s.parts.every((p) => p.state !== "input-streaming" && p.state !== "input-available"))
  const lastSeg = segments[segments.length - 1]
  const trailingDots = streaming && segments.length > 0 && settled && lastSeg?.kind !== "text" && lastSeg?.kind !== "reasoning"

  return (
    <>
      {showStamp && createdAt ? <p className="mt-6 mb-1 text-center text-[11px] font-medium text-faint">{chatStamp(createdAt)}</p> : null}
      <div className={cn("flex px-5", mine ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-3")}>
        <div className={cn("flex min-w-0 max-w-[min(36rem,85%)] flex-col gap-1", mine ? "items-end" : "items-start")}>
          {named ? (
            <div className="mb-0.5 flex items-center gap-1.5 text-[12.5px]">
              <BotAvatar bot={bot} size="xs" working={streaming} />
              <span className={cn("font-semibold", colorOf(bot).fg)}>{bot?.name ?? "Bot"}</span>
              {addressedTo ? (
                <>
                  <ArrowRight className="size-3 text-faint" aria-label="to" />
                  <MentionChip bot={addressedTo} className="text-muted!" />
                </>
              ) : null}
            </div>
          ) : null}
          {busy ? <TypingDots /> : null}
          <div className={cn("selectable flex w-full flex-col gap-1", mine ? "items-end" : "items-start")}>
            {segments.map((s, i) => {
              switch (s.kind) {
                case "text":
                  return (
                    <div
                      key={i}
                      className={cn(
                        "prose-chat max-w-full rounded-[18px] px-3.5 py-2",
                        mine ? "bubble-mine bg-fg text-bg" : "bg-raised text-fg",
                      )}
                    >
                      <Markdown text={s.text} streaming={streaming && s.index === lastText} />
                    </div>
                  )
                case "reasoning":
                  return <Reasoning key={i} text={s.text} streaming={streaming && s.index === lastText} />
                case "image":
                  return <img key={i} src={s.url} alt="" className="max-h-72 rounded-[18px] border border-line" />
                case "tools":
                  return <ActivityGroup key={i} parts={s.parts} live={streaming} />
                case "event":
                  return <BotEvent key={i} part={s.part} fromBotId={bot?.id} />
                case "approval":
                  return (
                    <ToolRow key={i} part={s.part}>
                      <ApprovalCard approval={s.approval} compact />
                    </ToolRow>
                  )
              }
            })}
            {trailingDots ? <TypingDots className="mt-0.5" /> : null}
          </div>
        </div>
      </div>
    </>
  )
})
