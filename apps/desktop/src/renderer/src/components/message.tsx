import type { UIMessage } from "ai"
import { AtSign, CalendarClock, ChevronRight, Sparkles, TriangleAlert } from "lucide-react"
import { memo, useState } from "react"
import { Streamdown } from "streamdown"
import { Link } from "wouter"

import type { Approval, Bot } from "@/lib/types"
import { cn, shortTime } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { ApprovalCard } from "./inbox-cards"
import { ToolRow, type ToolPart } from "./tool-row"

type Author = { kind: "user"; name: string } | { kind: "bot"; bot: Bot | undefined } | { kind: "system" }

export type MessageProps = {
  id: string
  author: Author
  parts: UIMessage["parts"]
  metadata?: Record<string, unknown> | null
  createdAt?: string
  streaming?: boolean
  approvals?: Approval[]
  // Consecutive messages from the same author drop the header
  grouped?: boolean
}

function Reasoning({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-[12.5px] text-faint hover:text-muted">
        <Sparkles className={cn("size-3.5", streaming && "animate-pulse-soft")} />
        {streaming ? "Thinking…" : "Thought it through"}
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? <p className="selectable ml-5 mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-[12.5px] text-muted">{text}</p> : null}
    </div>
  )
}

export const Message = memo(function Message({ author, parts, metadata, createdAt, streaming, approvals, grouped }: MessageProps) {
  const meta = (metadata ?? {}) as { via?: string; botThreadId?: string; scheduleName?: string; takeoverId?: string }

  if (author.kind === "system") {
    const text = parts.map((p) => (p.type === "text" ? p.text : "")).join("")
    if (meta.scheduleName) {
      return (
        <div className="my-3 flex justify-center">
          <div className="max-w-lg rounded-xl border border-line bg-raised/50 px-3 py-2 text-[12.5px]">
            <p className="flex items-center gap-1.5 font-medium text-muted">
              <CalendarClock className="size-3.5" /> Scheduled · {meta.scheduleName}
            </p>
            <p className="selectable mt-1 text-fg">{text}</p>
          </div>
        </div>
      )
    }
    return (
      <div className="my-3 flex justify-center">
        <p className="flex items-center gap-1.5 rounded-full bg-danger/8 px-3 py-1 text-[12px] text-danger">
          <TriangleAlert className="size-3.5" /> {text}
        </p>
      </div>
    )
  }

  const name = author.kind === "user" ? author.name : (author.bot?.name ?? "Bot")
  const lastIndex = parts.length - 1

  return (
    <div className={cn("group flex gap-3 px-6", grouped ? "pt-0.5" : "pt-4")}>
      <div className="w-8 shrink-0">
        {grouped ? null : author.kind === "bot" ? (
          <BotAvatar bot={author.bot} size="md" working={streaming} />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-fg text-[12px] font-semibold text-bg">{name.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">{name}</span>
            {author.kind === "bot" && author.bot ? <span className="text-[11.5px] text-faint">{author.bot.job}</span> : null}
            {meta.via === "bot_message" ? (
              <Link href={meta.botThreadId ? `/t/${meta.botThreadId}` : "#"} className="flex items-center gap-0.5 text-[11.5px] text-accent hover:underline">
                <AtSign className="size-3" /> replied by message
              </Link>
            ) : null}
            {createdAt ? <span className="text-[11px] text-faint opacity-0 transition-opacity group-hover:opacity-100">{shortTime(createdAt)}</span> : null}
          </div>
        )}
        <div className="selectable">
          {parts.map((part, i) => {
            if (part.type === "text") {
              if (!part.text) return null
              return (
                <div key={i} className="prose-chat">
                  <Streamdown isAnimating={streaming && i === lastIndex} mode={streaming ? "streaming" : "static"}>
                    {part.text}
                  </Streamdown>
                </div>
              )
            }
            if (part.type === "reasoning") {
              if (!part.text.trim()) return null
              return <Reasoning key={i} text={part.text} streaming={streaming && i === lastIndex} />
            }
            if (part.type === "file" && part.mediaType.startsWith("image/")) {
              return <img key={i} src={part.url} alt="" className="my-2 max-h-72 rounded-lg border border-line" />
            }
            if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
              const tp = part as unknown as ToolPart
              const pending = tp.state === "approval-requested" ? approvals?.find((a) => a.toolCallId === tp.approval?.id) : undefined
              return (
                <ToolRow key={tp.toolCallId ?? i} part={tp}>
                  {pending ? <ApprovalCard approval={pending} compact /> : null}
                </ToolRow>
              )
            }
            return null
          })}
        </div>
      </div>
    </div>
  )
})
