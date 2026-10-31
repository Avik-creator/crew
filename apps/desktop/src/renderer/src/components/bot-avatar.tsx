import type { Bot, BotColor } from "@/lib/types"
import { cn } from "@/lib/utils"

export const BOT_COLORS: Record<BotColor, { bg: string; fg: string; ring: string; hex: string }> = {
  violet: { bg: "bg-violet-500/15", fg: "text-violet-500", ring: "ring-violet-500/50", hex: "#8b5cf6" },
  blue: { bg: "bg-blue-500/15", fg: "text-blue-500", ring: "ring-blue-500/50", hex: "#3b82f6" },
  emerald: { bg: "bg-emerald-500/15", fg: "text-emerald-500", ring: "ring-emerald-500/50", hex: "#10b981" },
  amber: { bg: "bg-amber-500/15", fg: "text-amber-500", ring: "ring-amber-500/50", hex: "#f59e0b" },
  rose: { bg: "bg-rose-500/15", fg: "text-rose-500", ring: "ring-rose-500/50", hex: "#f43f5e" },
  cyan: { bg: "bg-cyan-500/15", fg: "text-cyan-500", ring: "ring-cyan-500/50", hex: "#06b6d4" },
  orange: { bg: "bg-orange-500/15", fg: "text-orange-500", ring: "ring-orange-500/50", hex: "#f97316" },
  pink: { bg: "bg-pink-500/15", fg: "text-pink-500", ring: "ring-pink-500/50", hex: "#ec4899" },
}

const SIZES = { xs: "size-5 text-[9px]", sm: "size-6 text-[10.5px]", md: "size-8 text-[12px]", lg: "size-11 text-[15px]", xl: "size-16 text-[22px]" }

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
  const c = BOT_COLORS[bot?.color ?? "violet"] ?? BOT_COLORS.violet
  // Tiny avatars fit one letter
  const label = bot?.avatar || (bot?.name ?? "?").slice(0, size === "xs" || size === "sm" ? 1 : 2)
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-semibold", SIZES[size], c.bg, c.fg, className)}>
      <span className={bot?.avatar ? "text-[1.15em]" : "uppercase"}>{label}</span>
      {working ? (
        <span className={cn("absolute -inset-[3px] rounded-full ring-2 animate-pulse-soft", c.ring)} aria-label="working" />
      ) : null}
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
