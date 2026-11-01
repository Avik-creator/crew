import { Ellipsis, Eraser, Monitor, Pause, Pencil, Play, Trash, Users } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { AvatarStack, BotAvatar } from "@/components/bot-avatar"
import { Composer, type ComposerSend } from "@/components/composer"
import { TakeoverCard } from "@/components/inbox-cards"
import { Message } from "@/components/message"
import { ScreenPanel } from "@/components/screen-panel"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { EmptyState, Tip } from "@/components/ui/misc"
import { api } from "@/lib/api"
import { liveRuns, useLiveRuns } from "@/lib/live"
import { keys, queryClient, useAction, useApprovals, useBots, useMe, useMessages, useTakeovers, useThreads } from "@/lib/queries"
import { useLiveMessage } from "@/lib/run-stream"
import type { ActiveRun, Bot, StoredMessage, Thread } from "@/lib/types"
import { useUI } from "@/lib/ui"
import { errorMessage } from "@/lib/utils"

function LiveReply({ run, bot, onMessageId }: { run: ActiveRun; bot: Bot | undefined; onMessageId: (id: string | null) => void }) {
  const message = useLiveMessage(run.triggerRunId)
  const approvals = useApprovals()
  useEffect(() => onMessageId(message?.id ?? null), [message?.id, onMessageId])
  return (
    <Message
      id={message?.id ?? run.triggerRunId}
      author={{ kind: "bot", bot }}
      parts={message?.parts ?? []}
      streaming
      approvals={approvals.data}
    />
  )
}

function ThreadHeader({ thread, bots, title, onScreen, screenOpen }: { thread: Thread; bots: Bot[]; title: string; onScreen: () => void; screenOpen: boolean }) {
  const ui = useUI()
  const [, navigate] = useLocation()
  const bot = thread.kind === "direct" ? bots[0] : undefined
  const update = useAction((status: "active" | "paused") => api(`/bots/${bot!.id}`, { method: "PATCH", body: { status } }), [keys.bots])
  const clear = useAction(() => api(`/threads/${thread.id}/clear`, { method: "POST" }), [keys.messages(thread.id), keys.threads])
  const remove = useAction(() => api(`/threads/${thread.id}`, { method: "DELETE" }), [keys.threads])
  const removeBot = useAction(() => api(`/bots/${bot!.id}`, { method: "DELETE" }), [keys.bots, keys.threads])

  return (
    <header className="drag flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-line px-5">
      <div className="no-drag flex min-w-0 items-center gap-2.5">
        {bot ? <BotAvatar bot={bot} size="sm" /> : thread.kind === "group" ? <Users className="size-4 text-muted" /> : <AvatarStack bots={bots} size="xs" />}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em]">{title}</p>
        </div>
        {thread.kind === "group" ? <AvatarStack bots={bots} max={5} size="xs" /> : null}
      </div>
      <div className="no-drag flex items-center gap-1">
        {bots.length ? (
          <Tip label={screenOpen ? "Hide screen" : "Watch the screen"}>
            <Button size="icon-sm" variant={screenOpen ? "secondary" : "ghost"} onClick={onScreen} aria-label={screenOpen ? "Hide screen" : "Watch the screen"}>
              <Monitor />
            </Button>
          </Tip>
        ) : null}
        <Menu>
          <MenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More">
              <Ellipsis />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {bot ? (
              <>
                <MenuItem onSelect={() => ui.editBot(bot)}>
                  <Pencil /> Edit {bot.name}
                </MenuItem>
                <MenuItem onSelect={() => update.mutate(bot.status === "paused" ? "active" : "paused")}>
                  {bot.status === "paused" ? <Play /> : <Pause />} {bot.status === "paused" ? "Resume" : "Pause"}
                </MenuItem>
              </>
            ) : thread.kind === "group" ? (
              <MenuItem onSelect={() => ui.editGroup(thread)}>
                <Pencil /> Edit group
              </MenuItem>
            ) : null}
            <MenuItem onSelect={() => clear.mutate(undefined)}>
              <Eraser /> Clear conversation
            </MenuItem>
            <MenuSeparator />
            {bot ? (
              <MenuItem
                danger
                onSelect={() => {
                  if (confirm(`Delete ${bot.name}? Its chat and notes are removed.`)) removeBot.mutate(undefined, { onSuccess: () => navigate("/") })
                }}
              >
                <Trash /> Delete bot
              </MenuItem>
            ) : (
              <MenuItem
                danger
                onSelect={() => {
                  if (confirm("Delete this conversation?")) remove.mutate(undefined, { onSuccess: () => navigate("/") })
                }}
              >
                <Trash /> Delete conversation
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </div>
    </header>
  )
}

export function ChatRoute({ threadId }: { threadId: string }) {
  const me = useMe()
  const threads = useThreads()
  const bots = useBots()
  const messages = useMessages(threadId)
  const approvals = useApprovals()
  const takeovers = useTakeovers()
  const live = useLiveRuns(threadId)
  const [screen, setScreen] = useState<{ open: boolean; botId?: string; control?: boolean }>({ open: false })
  const [liveIds, setLiveIds] = useState<Record<string, string | null>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const thread = threads.data?.find((t) => t.id === threadId)
  const byId = useMemo(() => new Map((bots.data ?? []).map((b) => [b.id, b])), [bots.data])
  const members = (thread?.botIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Bot[]
  const title = thread?.kind === "direct" ? (members[0]?.name ?? "Chat") : thread?.kind === "group" ? (thread.name ?? "Group") : members.map((m) => m.name).join(" ↔ ")
  const pendingTakeovers = (takeovers.data ?? []).filter((t) => t.threadId === threadId)

  // Mark as read when opened and when new messages arrive while open
  useEffect(() => {
    if (!thread?.unread) return
    void api(`/threads/${threadId}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: keys.threads }))
  }, [threadId, thread?.unread, messages.data?.length])

  // Pick up turns that were already running when the thread opened
  useEffect(() => {
    for (const r of thread?.activeRuns ?? []) if (r.triggerRunId) liveRuns.add(threadId, r)
  }, [threadId, thread?.activeRuns])

  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  const send = useAction((msg: ComposerSend) =>
    api<{ message: StoredMessage; runs: ActiveRun[]; routedReason: string | null }>(`/threads/${threadId}/messages`, { body: msg }),
  )

  const onSend = async (msg: ComposerSend) => {
    stick.current = true
    try {
      const res = await send.mutateAsync(msg)
      queryClient.setQueryData<StoredMessage[]>(keys.messages(threadId), (old) => {
        const list = old ?? []
        return list.some((m) => m.id === res.message.id) ? list : [...list, res.message]
      })
      for (const r of res.runs) liveRuns.add(threadId, r)
      if (!res.runs.length) toast("Nobody's available to answer. Resume a paused bot or add one to the group.")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const stop = async () => {
    await Promise.all(live.map((r) => api(`/runs/${r.triggerRunId}/cancel`, { method: "POST" }).catch(() => {})))
    for (const r of live) liveRuns.remove(threadId, r.botId)
  }

  if (!thread) {
    return threads.isLoading ? null : <EmptyState icon={<Users />} title="Conversation not found" body="It may have been deleted." />
  }

  const stored = messages.data ?? []
  // A finished run leaves its id in liveIds. Only a run still on screen should hide the saved row.
  const liveMessageIds = new Set(live.flatMap((r) => {
    const id = liveIds[r.triggerRunId]
    return id ? [id] : []
  }))

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader thread={thread} bots={members} title={title} screenOpen={screen.open} onScreen={() => setScreen((s) => ({ open: !s.open, botId: s.botId }))} />
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto pb-4"
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
        >
          {!stored.length && !live.length ? (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm text-center">
                {thread.kind === "direct" && members[0] ? (
                  <>
                    <BotAvatar bot={members[0]} size="xl" className="mx-auto" />
                    <h2 className="mt-4 text-[17px] font-semibold">{members[0].name}</h2>
                    <p className="mt-1 text-[13px] text-muted">{members[0].job}</p>
                    <p className="mt-4 text-[12.5px] text-faint">Ask for something. It can use its own screen, the apps you connected, and message other bots.</p>
                  </>
                ) : (
                  <>
                    <AvatarStack bots={members} max={6} size="md" />
                    <h2 className="mt-4 text-[17px] font-semibold">{title}</h2>
                    <p className="mt-1 text-[13px] text-muted">
                      {thread.kind === "group" ? "Write to the group. The right bot answers; @mention to pick one." : "Bots haven't messaged each other yet."}
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl pt-2">
              {stored.map((m, i) => {
                if (liveMessageIds.has(m.id)) return null
                const prev = stored[i - 1]
                const grouped =
                  !!prev && prev.authorType === m.authorType && prev.authorId === m.authorId && m.authorType !== "system" &&
                  new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000
                const author =
                  m.authorType === "user"
                    ? ({ kind: "user", name: "You" } as const)
                    : m.authorType === "bot"
                      ? ({ kind: "bot", bot: byId.get(m.authorId ?? "") } as const)
                      : ({ kind: "system" } as const)
                return (
                  <Message
                    key={m.id}
                    id={m.id}
                    author={author}
                    parts={m.parts}
                    metadata={m.metadata}
                    createdAt={m.createdAt}
                    grouped={grouped}
                    approvals={approvals.data}
                  />
                )
              })}
              {live.map((r) => (
                <LiveReply
                  key={r.triggerRunId}
                  run={r}
                  bot={byId.get(r.botId)}
                  onMessageId={(id) => setLiveIds((s) => (s[r.triggerRunId] === id ? s : { ...s, [r.triggerRunId]: id }))}
                />
              ))}
              {pendingTakeovers.map((t) => (
                <div key={t.id} className="px-6 pl-[68px]">
                  <TakeoverCard takeover={t} onOpenScreen={() => setScreen({ open: true, botId: t.botId, control: true })} />
                </div>
              ))}
            </div>
          )}
        </div>
        {thread.kind !== "bot" ? (
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              members={members}
              placeholder={thread.kind === "direct" ? `Message ${members[0]?.name ?? ""}` : `Message ${title}`}
              working={live.length > 0}
              onSend={onSend}
              onStop={stop}
            />
          </div>
        ) : (
          <p className="pb-5 text-center text-[12px] text-faint">{me.data ? "This is between bots. Message one of them directly to step in." : null}</p>
        )}
      </div>
      {screen.open ? (
        <ScreenPanel bots={members} initialBotId={screen.botId ?? live[0]?.botId} controlRequested={screen.control} onClose={() => setScreen({ open: false })} />
      ) : null}
    </div>
  )
}
