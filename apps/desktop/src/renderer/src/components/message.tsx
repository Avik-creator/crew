import type { UIMessage } from "ai"
import { AtSign, CalendarClock, ChevronRight, TriangleAlert } from "lucide-react"
import { memo, useState } from "react"
import { Streamdown } from "streamdown"
import { Link } from "wouter"

import type { Approval, Bot } from "@/lib/types"
import { chatStamp, cn } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { ApprovalCard } from "./inbox-cards"
import { Spinner } from "./ui/spinner"
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

  const lastIndex = parts.length - 1
  const inProgress = streaming && parts.some((part) => {
    if (part.type === "text") return part.state === "streaming" && part.text.length > 0
    if (part.type === "reasoning") return part.state !== "done"
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      const state = (part as { state?: string }).state
      return state === "input-streaming" || state === "input-available" || state === "approval-requested" || state === "approval-responded"
    }
    return false
  })

  const mine = author.kind === "user"
  const fromBot = author.kind === "bot"

  return (
    <>
      {!grouped && createdAt ? <p className="mt-5 text-center text-[11px] text-faint">{chatStamp(createdAt)}</p> : null}
      <div className={cn("flex px-5", mine ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-2")}>
        {fromBot ? (
          <div className="mr-2 w-7 shrink-0">
            {grouped ? null : <BotAvatar bot={author.bot} size="sm" working={streaming} />}
          </div>
        ) : null}
        <div className={cn("flex min-w-0 max-w-[min(34rem,88%)] flex-col", mine ? "items-end" : "items-start")}>
          {meta.via === "bot_message" ? (
            <Link href={meta.botThreadId ? `/t/${meta.botThreadId}` : "#"} className="mb-1 flex items-center gap-0.5 text-[11.5px] text-accent hover:underline">
              <AtSign className="size-3" /> replied by message
            </Link>
          ) : null}
          <div className="selectable flex w-full flex-col gap-1.5">
            {parts.map((part, i) => {
              if (part.type === "text") {
                if (!part.text) return null
                return (
                  <div key={i} className={cn("prose-chat max-w-full rounded-[18px] px-3.5 py-2", mine ? "bg-fg text-bg" : "bg-raised text-fg")}>
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
                return <img key={i} src={part.url} alt="" className="max-h-72 rounded-[18px] border border-line" />
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
            {streaming && !inProgress ? (
              <p className="flex items-center gap-2 px-1 text-[12.5px] text-faint">
                <Spinner className="size-3.5" /> Working…
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
})
