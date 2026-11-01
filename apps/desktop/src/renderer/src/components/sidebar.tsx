import { Brain, CalendarClock, ChevronDown, Inbox, LogOut, Plug, Plus, Search, Settings, Sparkles } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"

import { useApprovals, useBots, useMe, useTakeovers, useThreads } from "@/lib/queries"
import type { Bot, Thread } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { cn, shortTime } from "@/lib/utils"

import { AvatarStack, BotAvatar, GroupAvatar } from "./bot-avatar"
import { Kbd, Tip } from "./ui/misc"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./ui/menu"

function NavItem({ href, icon, label, count }: { href: string; icon: ReactNode; label: string; count?: number }) {
  const [location] = useLocation()
  const active = location === href || location.startsWith(`${href}/`)
  return (
    <Link
      href={href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors [&_svg]:size-4",
        active ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/70 hover:text-fg",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold leading-[18px] text-accent-fg">{count}</span> : null}
    </Link>
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
  return (
    <Link
      href={`/t/${thread.id}`}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors",
        active ? "bg-fg/8 text-fg" : "text-muted hover:bg-fg/5 hover:text-fg",
      )}
    >
      {avatar}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[13px]", (thread.unread || active) && "font-medium text-fg")}>{label}</span>
          {thread.lastMessageAt ? <span className="shrink-0 text-[11px] text-faint">{shortTime(thread.lastMessageAt)}</span> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{plainPreview(thread.lastMessagePreview) || (working ? "Working" : (placeholder ?? ""))}</span>
          {working ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Working" /> : thread.unread && !active ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label="Unread" /> : null}
        </span>
      </span>
    </Link>
  )
}

function Group({ title, action, children, defaultOpen = true }: { title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-4">
      <div className="group/h flex h-6 items-center justify-between px-2.5">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-[11px] font-medium tracking-[0.04em] text-faint uppercase hover:text-muted">
          {title}
          <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
        </button>
        {action}
      </div>
      {open ? <div className="mt-1 space-y-px">{children}</div> : null}
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
  const botList = (bots.data ?? []).filter((b) => b.status !== "hidden")
  const byId = new Map(botList.map((b) => [b.id, b]))
  const all = threads.data ?? []
  const chief = botList.find((b) => b.role === "chief")
  const chiefThread = chief ? all.find((t) => t.id === chief.directThreadId) : undefined
  const direct = all.filter((t) => t.kind === "direct" && t.id !== chiefThread?.id)
  const groups = all.filter((t) => t.kind === "group")
  const botChats = all.filter((t) => t.kind === "bot")
  const inboxCount = (approvals.data?.length ?? 0) + (takeovers.data?.length ?? 0)

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag h-[52px] shrink-0" />
      <div className="px-3">
        <button
          onClick={ui.openPalette}
          className="flex h-7 w-full items-center gap-2 rounded-md bg-fg/5 px-2 text-[13px] text-faint transition-colors hover:bg-fg/8 hover:text-muted"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <div className="mt-3 space-y-px">
          <NavItem href="/inbox" icon={<Inbox />} label="Inbox" count={inboxCount} />
        </div>
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {chief && chiefThread ? (
          <div className="mt-3">
            <ThreadItem
              thread={chiefThread}
              label={chief.name}
              avatar={<ChiefAvatar bot={chief} working={chiefThread.working.length > 0} />}
              placeholder="Ask me to set up bots for you"
            />
          </div>
        ) : null}
        <Group
          title="Bots"
          action={
            <Tip label="New bot">
              <button onClick={() => ui.editBot()} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg" aria-label="New bot">
                <Plus className="size-3.5" />
              </button>
            </Tip>
          }
        >
          {direct.map((t) => {
            const bot = byId.get(t.botIds[0] ?? "")
            if (!bot) return null
            return (
              <ThreadItem
                key={t.id}
                thread={t}
                label={bot.name}
                avatar={<BotAvatar bot={bot} size="md" working={t.working.length > 0} className={bot.status === "paused" ? "opacity-50" : ""} />}
              />
            )
          })}
          {!direct.length ? (
            <button onClick={() => ui.editBot()} className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] text-muted hover:bg-hover">
              <span className="grid size-6 place-items-center rounded-full border border-dashed border-line-strong">
                <Plus className="size-3" />
              </span>
              Create your first bot
            </button>
          ) : null}
        </Group>

        <Group
          title="Groups"
          action={
            <Tip label="New group">
              <button onClick={() => ui.editGroup()} className="rounded p-0.5 text-faint hover:bg-hover hover:text-fg" aria-label="New group">
                <Plus className="size-3.5" />
              </button>
            </Tip>
          }
        >
          {groups.map((t) => (
            <ThreadItem
              key={t.id}
              thread={t}
              label={t.name ?? "Group"}
              avatar={<GroupAvatar bots={t.botIds.map((id) => byId.get(id))} size="md" />}
            />
          ))}
          {!groups.length ? <p className="px-2.5 py-1 text-[12px] text-faint">Bots work together in groups.</p> : null}
        </Group>

        {botChats.length ? (
          <Group title="Between bots" defaultOpen={false}>
            {botChats.map((t) => {
              const pair = t.botIds.map((id) => byId.get(id))
              return (
                <ThreadItem
                  key={t.id}
                  thread={t}
                    label={pair.map((b) => b?.name ?? "?").join(" ↔ ")}
                  avatar={<AvatarStack bots={pair} size="xs" />}
                />
              )
            })}
          </Group>
        ) : null}
      </div>

      <div className="space-y-px border-t border-line px-3 py-2">
        <NavItem href="/connections" icon={<Plug />} label="Connections" />
        <NavItem href="/schedules" icon={<CalendarClock />} label="Schedules" />
        <NavItem href="/memory" icon={<Brain />} label="Memory" />
        <NavItem href="/settings" icon={<Settings />} label="Settings" />
      </div>
      <div className="border-t border-line p-2">
        <Menu>
          <MenuTrigger className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-hover">
            <span className="grid size-7 place-items-center rounded-full bg-fg text-[11px] font-semibold text-bg">
              {(me.data?.user.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium">{me.data?.user.name}</span>
              <span className="block truncate text-[11px] text-faint">{me.data?.user.email}</span>
            </span>
          </MenuTrigger>
          <MenuContent align="start" className="w-56">
            <MenuItem asChild>
              <Link href="/settings">
                <Settings /> Settings
              </Link>
            </MenuItem>
            <MenuSeparator />
            <MenuItem danger onSelect={onSignOut}>
              <LogOut /> Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </aside>
  )
}
