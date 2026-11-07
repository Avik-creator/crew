import { Bell, Bot as BotIcon, Brain, CalendarClock, ChevronDown, LogOut, Plug, Plus, Search, Settings, Sparkles, Users } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"

import { useApprovals, useBots, useMe, useTakeovers, useThreads } from "@/lib/queries"
import type { Bot, Thread } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn, shortTime } from "@/lib/utils"

import { AvatarStack, BotAvatar, GroupAvatar } from "./bot-avatar"
import { ResizeHandle, useColumnWidth } from "./resize-handle"
import { Tip } from "./ui/misc"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu"

// A small icon button in the sidebar's header
function HeaderButton({ label, onClick, active, count, children }: { label: string; onClick: () => void; active?: boolean; count?: number; children: ReactNode }) {
  return (
    <Tip label={label}>
      <button
        onClick={onClick}
        aria-label={count ? `${label}, ${count} waiting` : label}
        className={cn(
          "no-drag relative grid size-7 place-items-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[15px] [&_svg]:stroke-[1.8]",
          active && "bg-hover text-fg",
        )}
      >
        {children}
        {count ? (
          <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-accent px-1 text-[9.5px] font-semibold leading-3.5 text-accent-fg">{count}</span>
        ) : null}
      </button>
    </Tip>
  )
}

// Previews are stored as the raw message; drop Markdown marks so they read cleanly
const plainPreview = (text: string) =>
  text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/(^|\n)\s*([#>]+|[-*] )\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()

// The main assistant's face carries a small spark, so it reads as the one in charge
export function ChiefAvatar({ bot, working, size = "md" }: { bot: Bot; working?: boolean; size?: "md" | "lg" | "xl" }) {
  return (
    <span className="relative inline-flex shrink-0">
      <BotAvatar bot={bot} size={size} working={working} />
      <span className="absolute -right-0.5 -bottom-0.5 grid size-3.5 place-items-center rounded-full bg-fg text-bg ring-2 ring-bg" aria-label="Main assistant">
        <Sparkles className="size-2" strokeWidth={2.5} />
      </span>
    </span>
  )
}

function ThreadItem({ thread, label, avatar, placeholder }: { thread: Thread; label: string; avatar: ReactNode; placeholder?: string }) {
  const [location] = useLocation()
  const active = location === `/t/${thread.id}`
  const working = thread.working.length > 0
  const unread = thread.unread && !active
  return (
    <Link
      href={`/t/${thread.id}`}
      className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors", active ? "bg-hover" : "hover:bg-fg/[0.05]")}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[13px] text-fg", unread ? "font-semibold" : "font-medium")}>{label}</span>
          {thread.lastMessageAt ? <span className="shrink-0 text-[12px] tabular-nums text-faint">{shortTime(thread.lastMessageAt)}</span> : null}
          {unread ? <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
        </span>
        <span
          className={cn(
            "mt-1 block truncate text-[12px]",
            working ? "font-semibold text-accent" : unread ? "font-medium text-fg/75" : "text-muted",
          )}
        >
          {working ? "Working…" : plainPreview(thread.lastMessagePreview) || placeholder || ""}
        </span>
      </span>
    </Link>
  )
}

function Group({ title, action, children, defaultOpen = true }: { title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="pt-3 pb-0.5">
      <div className="flex items-center justify-between gap-2 pr-1">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1 rounded-lg px-2.5 py-1 text-left text-[12px] font-medium text-muted transition-colors hover:bg-hover"
        >
          {title}
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </button>
        {action}
      </div>
      {open ? <div className="mt-0.5 flex flex-col gap-0.5">{children}</div> : null}
    </div>
  )
}

export function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const ui = useUI()
  const me = useMe()
  const bots = useBots()
  const threads = useThreads()
  const approvals = useApprovals()
  const takeovers = useTakeovers()
  const [location, navigate] = useLocation()
  const { width, setWidth } = useColumnWidth("crew:sidebar-width", 300, 240, 480)
  const botList = (bots.data ?? []).filter((b) => b.status !== "hidden")
  const byId = new Map(botList.map((b) => [b.id, b]))
  const all = threads.data ?? []
  const chief = botList.find((b) => b.role === "chief")
  const chiefThread = chief ? all.find((t) => t.id === chief.directThreadId) : undefined
  const direct = all.filter((t) => t.kind === "direct" && t.id !== chiefThread?.id)
  const groups = all.filter((t) => t.kind === "group")
  const botChats = all.filter((t) => t.kind === "bot")
  const inboxCount = (approvals.data?.length ?? 0) + (takeovers.data?.length ?? 0)
  const initial = (me.data?.user.name ?? "?").slice(0, 1).toUpperCase()

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-r border-fg/[0.06] bg-sidebar" style={{ width }}>
      {/* The traffic lights sit in the first 72px; the rest of the strip drags the window */}
      <div className="drag flex shrink-0 items-center justify-between px-[18px] pb-3 pt-4">
        <span className="h-3 w-[72px] shrink-0" />
        <div className="flex items-center gap-0.5">
          <HeaderButton label="Search  ⌘K" onClick={ui.openPalette}>
            <Search />
          </HeaderButton>
          <HeaderButton label="Inbox" onClick={() => navigate("/inbox")} active={location === "/inbox"} count={inboxCount}>
            <Bell />
          </HeaderButton>
          <Menu>
            <Tip label="New">
              <MenuTrigger asChild>
                <button
                  aria-label="New bot or group"
                  className="no-drag grid size-7 place-items-center rounded-[10px] text-muted transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[15px] [&_svg]:stroke-[1.8]"
                >
                  <Plus />
                </button>
              </MenuTrigger>
            </Tip>
            <MenuContent align="end" className="w-44">
              <MenuItem onSelect={() => ui.editBot()}>
                <BotIcon /> New bot
              </MenuItem>
              <MenuItem onSelect={() => ui.editGroup()}>
                <Users /> New group
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
        {chief && chiefThread ? (
          <ThreadItem
            thread={chiefThread}
            label={chief.name}
            avatar={<ChiefAvatar bot={chief} working={chiefThread.working.length > 0} size="lg" />}
            placeholder="Ask me to set up bots for you"
          />
        ) : null}
        <Group title="Bots">
          {direct.map((t) => {
            const bot = byId.get(t.botIds[0] ?? "")
            if (!bot) return null
            return (
              <ThreadItem
                key={t.id}
                thread={t}
                label={bot.name}
                avatar={<BotAvatar bot={bot} size="lg" working={t.working.length > 0} className={bot.status === "paused" ? "opacity-50" : ""} />}
              />
            )
          })}
          {!direct.length ? (
            <button onClick={() => ui.editBot()} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13px] text-muted hover:bg-fg/[0.05]">
              <span className="grid size-10 place-items-center rounded-full border border-dashed border-line-strong">
                <Plus className="size-4" />
              </span>
              Create your first bot
            </button>
          ) : null}
        </Group>

        <Group title="Groups">
          {groups.map((t) => (
            <ThreadItem key={t.id} thread={t} label={t.name ?? "Group"} avatar={<GroupAvatar bots={t.botIds.map((id) => byId.get(id))} size="lg" />} />
          ))}
          {!groups.length ? <p className="px-2.5 py-1 text-[12px] text-faint">Bots work together in groups.</p> : null}
        </Group>

        {botChats.length ? (
          <Group title="Between bots" defaultOpen={false}>
            {botChats.map((t) => {
              const pair = t.botIds.map((id) => byId.get(id))
              return <ThreadItem key={t.id} thread={t} label={pair.map((b) => b?.name ?? "?").join(" ↔ ")} avatar={<AvatarStack bots={pair} size="md" />} />
            })}
          </Group>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-2.5 py-3">
        <Menu>
          <MenuTrigger
            className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-hover text-[14px] font-medium transition-colors hover:border-fg/30"
            aria-label="Account and settings"
          >
            {initial}
          </MenuTrigger>
          <MenuContent align="start" className="w-64">
            <div className="px-2.5 py-2">
              <p className="truncate text-[13px] font-medium">{me.data?.user.name}</p>
              <p className="truncate text-[12px] text-faint">{me.data?.user.email}</p>
            </div>
            <MenuSeparator />
            <MenuItem asChild>
              <Link href="/settings">
                <Settings /> Settings
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/schedules">
                <CalendarClock /> Schedules
              </Link>
            </MenuItem>
            <MenuItem asChild>
              <Link href="/memory">
                <Brain /> Memory
              </Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={onSignOut}>
              <LogOut /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
        <Link
          href="/connections"
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-[10px] border border-line-strong bg-hover px-3 text-[13px] font-medium transition-colors hover:bg-fg/12",
            location === "/connections" && "border-fg/30",
          )}
        >
          <span className="truncate">Connect apps</span>
          <Plug className="size-4 shrink-0 text-muted" />
        </Link>
      </div>
      <ResizeHandle side="end" width={width} onWidth={setWidth} label="Resize sidebar" />
    </aside>
  )
}
