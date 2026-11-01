import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"

export type MentionMenuState = {
  items: Bot[]
  query: string
  index: number
  rect: DOMRect | null
  pick: (bot: Bot) => void
}

const WIDTH = 288

// Ranks bots for a typed query: name prefix, then a word in the name, then
// anywhere in the name or job
export function rankBots(bots: Bot[], query: string, memberIds: string[] = []) {
  const q = query.trim().toLowerCase()
  const score = (b: Bot) => {
    const name = b.name.toLowerCase()
    const base = !q ? 0 : name.startsWith(q) ? 0 : name.split(/\s+/).some((w) => w.startsWith(q)) ? 1 : name.includes(q) ? 2 : b.job.toLowerCase().includes(q) ? 3 : -1
    return base < 0 ? -1 : base + (memberIds.includes(b.id) ? 0 : 0.5)
  }
  return bots
    .map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.b.name.localeCompare(b.b.name))
    .map((x) => x.b)
    .slice(0, 8)
}

// The list that opens under "@" in the composer. Focus stays in the editor;
// arrow keys move the highlight through the editor's key handler.
export function MentionMenu({ state, memberIds = [], id }: { state: MentionMenuState; memberIds?: string[]; id: string }) {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector(`[data-index="${state.index}"]`)?.scrollIntoView({ block: "nearest" })
  }, [state.index])

  if (!state.rect) return null
  const left = Math.max(8, Math.min(state.rect.left - 8, window.innerWidth - WIDTH - 8))
  const bottom = window.innerHeight - state.rect.top + 8
  const showsMembership = memberIds.length > 0

  return createPortal(
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="Mention a bot"
      style={{ left, bottom, width: WIDTH }}
      className="fixed z-50 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-pop animate-fade-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      {state.items.length ? (
        state.items.map((bot, i) => (
          <div
            key={bot.id}
            id={`${id}-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === state.index}
            onClick={() => state.pick(bot)}
            className={cn(
              "flex cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5",
              i === state.index ? "bg-hover" : "hover:bg-hover/60",
              bot.status === "paused" && "opacity-60",
            )}
          >
            <BotAvatar bot={bot} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-fg">{bot.name}</span>
                {bot.status === "paused" ? <span className="text-[11px] text-faint">paused</span> : null}
              </span>
              <span className="block truncate text-[11.5px] text-faint">{bot.job}</span>
            </span>
            {showsMembership && !memberIds.includes(bot.id) ? <span className="shrink-0 text-[10.5px] text-faint">not here</span> : null}
          </div>
        ))
      ) : (
        <p className="px-2.5 py-2 text-[12.5px] text-faint">No bot called “{state.query}”</p>
      )}
    </div>,
    document.body,
  )
}
