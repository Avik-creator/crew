import type { CSSProperties } from "react"
import { Link } from "wouter"

import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { BotAvatar, colorOf } from "./bot-avatar"

// A bot named inline: its face and its name in its color. Opens its chat.
export function MentionChip({ bot, at = false, className }: { bot: Bot | undefined; at?: boolean; className?: string }) {
  if (!bot) return <span className={cn("font-medium", className)}>someone</span>
  const body = (
    <>
      <BotAvatar bot={bot} size="2xs" className="relative top-[-0.06em] mr-[0.3em] align-middle" />
      {at ? "@" : null}
      {bot.name}
    </>
  )
  const classes = cn("whitespace-nowrap font-medium", colorOf(bot).fg, className)
  const style = { "--chip": colorOf(bot).hex } as CSSProperties
  return bot.directThreadId ? (
    <Link href={`/t/${bot.directThreadId}`} data-mention style={style} className={cn(classes, "hover:underline")}>
      {body}
    </Link>
  ) : (
    <span data-mention style={style} className={classes}>{body}</span>
  )
}

// "A", "A and B", "A, B and C"
export function MentionList({ bots }: { bots: (Bot | undefined)[] }) {
  return (
    <>
      {bots.map((b, i) => (
        <span key={b?.id ?? i}>
          {i > 0 ? <span className="text-faint">{i === bots.length - 1 ? " and " : ", "}</span> : null}
          <MentionChip bot={b} />
        </span>
      ))}
    </>
  )
}
