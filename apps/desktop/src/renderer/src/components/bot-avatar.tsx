import { useEffect, useRef } from "react"

import type { Bot, BotColor } from "@/lib/types"
import { cn } from "@/lib/utils"

export const BOT_COLORS: Record<BotColor, { bg: string; fg: string; ring: string; hex: string }> = {
  violet: { bg: "bg-violet-500/15", fg: "text-violet-500 dark:text-violet-400", ring: "ring-violet-500/50", hex: "#8b5cf6" },
  blue: { bg: "bg-blue-500/15", fg: "text-blue-600 dark:text-blue-400", ring: "ring-blue-500/50", hex: "#3b82f6" },
  emerald: { bg: "bg-emerald-500/15", fg: "text-emerald-600 dark:text-emerald-400", ring: "ring-emerald-500/50", hex: "#10b981" },
  amber: { bg: "bg-amber-500/15", fg: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/50", hex: "#f59e0b" },
  rose: { bg: "bg-rose-500/15", fg: "text-rose-600 dark:text-rose-400", ring: "ring-rose-500/50", hex: "#f43f5e" },
  cyan: { bg: "bg-cyan-500/15", fg: "text-cyan-600 dark:text-cyan-400", ring: "ring-cyan-500/50", hex: "#06b6d4" },
  orange: { bg: "bg-orange-500/15", fg: "text-orange-600 dark:text-orange-400", ring: "ring-orange-500/50", hex: "#f97316" },
  pink: { bg: "bg-pink-500/15", fg: "text-pink-600 dark:text-pink-400", ring: "ring-pink-500/50", hex: "#ec4899" },
}

export const colorOf = (bot: Pick<Bot, "color"> | undefined) => BOT_COLORS[bot?.color ?? "violet"] ?? BOT_COLORS.violet

const SIZES = {
  "2xs": "size-3.5",
  xs: "size-5",
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
  xl: "size-16",
} as const

const EMOJI = { "2xs": "text-[8px]", xs: "text-[11px]", sm: "text-[13px]", md: "text-[17px]", lg: "text-[21px]", xl: "text-[34px]" } as const

// Small stable number from the name, so each bot keeps the same look
const seed = (name: string) => [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)

// Every face on screen looks toward the pointer. One listener for the whole
// window, one read per face per frame, and no React renders: the eyes are
// moved straight on the DOM.
const faces = new Set<SVGGElement>()
let pointer: { x: number; y: number } | null = null
let frame = 0

const REACH = 260 // px of pointer distance for a full glance
const MAX_X = 1.7 // viewBox units the eyes may travel
const MAX_Y = 1.3

function look() {
  frame = 0
  for (const eyes of faces) {
    const box = eyes.ownerSVGElement?.getBoundingClientRect()
    if (!box?.width || !pointer) {
      eyes.style.transform = ""
      continue
    }
    const dx = pointer.x - (box.left + box.width / 2)
    const dy = pointer.y - (box.top + box.height / 2)
    const d = Math.hypot(dx, dy) || 1
    const pull = Math.min(1, d / REACH)
    eyes.style.transform = `translate(${((dx / d) * MAX_X * pull).toFixed(2)}px, ${((dy / d) * MAX_Y * pull).toFixed(2)}px)`
  }
}

const schedule = () => (frame ||= requestAnimationFrame(look))
const onMove = (e: PointerEvent) => {
  pointer = { x: e.clientX, y: e.clientY }
  schedule()
}
const onLeave = () => {
  pointer = null
  schedule()
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

function track(eyes: SVGGElement) {
  if (reducedMotion()) return () => {}
  if (!faces.size) {
    window.addEventListener("pointermove", onMove, { passive: true })
    document.documentElement.addEventListener("pointerleave", onLeave)
    window.addEventListener("blur", onLeave)
  }
  faces.add(eyes)
  schedule()
  return () => {
    faces.delete(eyes)
    if (!faces.size) {
      window.removeEventListener("pointermove", onMove)
      document.documentElement.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("blur", onLeave)
    }
  }
}

// A round face in the bot's color. The resting gaze and eye shape come from
// the name, so bots with the same color still look different; the eyes follow
// the pointer and blink now and then.
function Face({ name }: { name: string }) {
  const eyes = useRef<SVGGElement>(null)
  useEffect(() => (eyes.current ? track(eyes.current) : undefined), [])
  const s = seed(name)
  const dx = ((s % 3) - 1) * 0.6
  const dy = (((s >> 2) % 3) - 1) * 0.4
  const tall = (s >> 4) % 2 === 0
  const h = tall ? 4.4 : 3.6
  const y = 9.6 + dy - h / 2 + 1.6
  return (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden>
      <g ref={eyes} className="face-eyes">
        <g className="face-blink" style={{ animationDelay: `${-(s % 5000)}ms`, animationDuration: `${4200 + (s % 2400)}ms` }}>
          <rect x={8.1 + dx} y={y} width={2.3} height={h} rx={1.15} fill="rgb(0 0 0 / 0.72)" />
          <rect x={13.6 + dx} y={y} width={2.3} height={h} rx={1.15} fill="rgb(0 0 0 / 0.72)" />
        </g>
      </g>
    </svg>
  )
}

export function BotAvatar({
  bot,
  size = "md",
  working,
  className,
}: {
  bot: Pick<Bot, "name" | "color" | "avatar"> | undefined
  size?: keyof typeof SIZES
  working?: boolean
  className?: string
}) {
  const c = colorOf(bot)
  const emoji = bot?.avatar
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center rounded-full", SIZES[size], emoji && c.bg, className)}
      style={emoji ? undefined : { backgroundColor: c.hex }}
      role="img"
      aria-label={bot?.name ?? "Bot"}
    >
      {emoji ? <span className={cn("leading-none", EMOJI[size])}>{emoji}</span> : <Face name={bot?.name ?? "?"} />}
      {working ? <span className={cn("absolute -inset-[3px] rounded-full ring-2 animate-pulse-soft", c.ring)} aria-hidden /> : null}
    </span>
  )
}

export function AvatarStack({ bots, max = 3, size = "sm" }: { bots: (Bot | undefined)[]; max?: number; size?: "xs" | "sm" | "md" }) {
  const shown = bots.filter(Boolean).slice(0, max) as Bot[]
  return (
    <span className="flex -space-x-1.5">
      {shown.map((b) => (
        <BotAvatar key={b.id} bot={b} size={size} className="ring-2 ring-bg" />
      ))}
      {bots.length > max ? (
        <span className="grid size-6 place-items-center rounded-full bg-raised text-[10px] font-medium text-muted ring-2 ring-bg">+{bots.length - max}</span>
      ) : null}
    </span>
  )
}

// Up to three faces packed into one avatar-sized circle, for group chats
export function GroupAvatar({ bots, size = "md", className }: { bots: (Bot | undefined)[]; size?: "sm" | "md" | "lg"; className?: string }) {
  const shown = bots.filter(Boolean).slice(0, 3) as Bot[]
  const box = { sm: "size-6", md: "size-8", lg: "size-10" }[size]
  const slots = [
    "left-0 top-0 w-[62%]",
    "right-0 bottom-0 w-[62%]",
    "left-[4%] bottom-0 w-[52%]",
  ]
  if (shown.length < 2) return <BotAvatar bot={shown[0]} size={size} className={className} />
  return (
    <span className={cn("relative inline-block shrink-0", box, className)} role="img" aria-label={shown.map((b) => b.name).join(", ")}>
      {shown.map((b, i) => (
        <span key={b.id} className={cn("absolute aspect-square rounded-full ring-2 ring-bg", slots[i])} style={{ backgroundColor: colorOf(b).hex }}>
          <Face name={b.name} />
        </span>
      ))}
    </span>
  )
}
