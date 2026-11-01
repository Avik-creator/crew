import { Command } from "cmdk"
import { Brain, CalendarClock, Inbox, MessageSquare, Plug, Plus, Settings, Users } from "lucide-react"
import { Dialog as D } from "radix-ui"
import { useEffect, useState, type ReactNode } from "react"
import { useLocation } from "wouter"

import { api } from "@/lib/api"
import { useBots, useThreads } from "@/lib/queries"
import type { SearchResults } from "@/lib/types"
import { useUI } from "@/lib/ui"

import { BotAvatar } from "./bot-avatar"

function Item({ onSelect, icon, children, hint }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-hover [&>svg]:size-4 [&>svg]:text-muted"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-[11.5px] text-faint">{hint}</span> : null}
    </Command.Item>
  )
}

// ⌘K: jump anywhere, start anything, and search every conversation
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const ui = useUI()
  const [, navigate] = useLocation()
  const bots = useBots()
  const threads = useThreads()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResults | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  useEffect(() => {
    if (query.trim().length < 2) return setResults(null)
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      api<SearchResults>(`/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal }).then(setResults, () => {})
    }, 180)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [query])

  const go = (path: string) => {
    onOpenChange(false)
    navigate(path)
  }
  const botById = new Map((bots.data ?? []).map((b) => [b.id, b]))
  const threadName = (id: string) => {
    const t = threads.data?.find((x) => x.id === id)
    if (!t) return "Conversation"
    if (t.kind === "direct") return botById.get(t.botIds[0] ?? "")?.name ?? "Chat"
    return t.name ?? t.botIds.map((b) => botById.get(b)?.name).join(" ↔ ")
  }

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <D.Content className="no-drag fixed left-1/2 top-[14vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-panel shadow-pop outline-none">
          <D.Title className="sr-only">Search</D.Title>
          <D.Description className="sr-only">Search conversations, bots and actions</D.Description>
          <Command shouldFilter={!results} loop>
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search messages, jump to a bot, or type a command…"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
            />
            <Command.List className="max-h-[56vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nothing found.</Command.Empty>
              {results?.messages.length ? (
                <Command.Group heading="Messages" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                  {results.messages.map((m) => (
                    <Item key={m.id} icon={<MessageSquare />} onSelect={() => go(`/t/${m.threadId}`)} hint={threadName(m.threadId)}>
                      {m.snippet.split(/<<|>>/).map((s, i) => (i % 2 ? <mark key={i} className="rounded bg-accent-soft px-0.5 text-fg">{s}</mark> : <span key={i}>{s}</span>))}
                    </Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Bots" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                {(bots.data ?? []).map((b) => (
                  <Item key={b.id} icon={<BotAvatar bot={b} size="xs" />} onSelect={() => b.directThreadId && go(`/t/${b.directThreadId}`)} hint={b.job}>
                    {b.name}
                  </Item>
                ))}
                {(threads.data ?? [])
                  .filter((t) => t.kind === "group")
                  .map((t) => (
                    <Item key={t.id} icon={<Users />} onSelect={() => go(`/t/${t.id}`)} hint="Group">
                      {t.name}
                    </Item>
                  ))}
              </Command.Group>
              <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-faint">
                <Item icon={<Plus />} onSelect={() => (onOpenChange(false), ui.editBot())}>New bot</Item>
                <Item icon={<Users />} onSelect={() => (onOpenChange(false), ui.editGroup())}>New group</Item>
                <Item icon={<Inbox />} onSelect={() => go("/inbox")}>Inbox</Item>
                <Item icon={<Plug />} onSelect={() => go("/connections")}>Connections</Item>
                <Item icon={<CalendarClock />} onSelect={() => go("/schedules")}>Schedules</Item>
                <Item icon={<Brain />} onSelect={() => go("/memory")}>Memory</Item>
                <Item icon={<Settings />} onSelect={() => go("/settings")}>Settings</Item>
              </Command.Group>
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
