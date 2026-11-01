import { ArrowDown, Ellipsis, Eraser, Monitor, Pause, Pencil, Play, Trash, Users } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useStickToBottom } from "use-stick-to-bottom"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { BotMessagesDivider } from "@/components/activity"
import { AvatarStack, BotAvatar, GroupAvatar } from "@/components/bot-avatar"
import { Composer, type ComposerSend } from "@/components/composer"
import { TakeoverCard } from "@/components/inbox-cards"
import { Message, type ChatLayout } from "@/components/message"
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
import { cn, errorMessage } from "@/lib/utils"

function LiveReply({ run, bot, layout, onMessageId }: { run: ActiveRun; bot: Bot | undefined; layout: ChatLayout; onMessageId: (id: string | null) => void }) {
  const message = useLiveMessage(run.triggerRunId)
  const approvals = useApprovals()
  useEffect(() => onMessageId(message?.id ?? null), [message?.id, onMessageId])
  return (
    <Message
      id={message?.id ?? run.triggerRunId}
      author={{ kind: "bot", bot }}
      parts={message?.parts ?? []}
      streaming
      layout={layout}
      approvals={approvals.data}
    />
  )
}

function ThreadHeader({
  thread,
  bots,
  title,
  working,
  onScreen,
  screenOpen,
}: {
  thread: Thread
  bots: Bot[]
  title: string
  working: boolean
  onScreen: () => void
  screenOpen: boolean
}) {
  const ui = useUI()
  const [, navigate] = useLocation()
  const bot = thread.kind === "direct" ? bots[0] : undefined
  const update = useAction((status: "active" | "paused") => api(`/bots/${bot!.id}`, { method: "PATCH", body: { status } }), [keys.bots])
  const clear = useAction(() => api(`/threads/${thread.id}/clear`, { method: "POST" }), [keys.messages(thread.id), keys.threads])
  const remove = useAction(() => api(`/threads/${thread.id}`, { method: "DELETE" }), [keys.threads])
  const removeBot = useAction(() => api(`/bots/${bot!.id}`, { method: "DELETE" }), [keys.bots, keys.threads])

  const subtitle = working
    ? "Working…"
    : bot
      ? bot.status === "paused"
        ? "Paused"
        : bot.job
      : thread.kind === "group"
        ? bots.map((b) => b.name).join(", ")
        : "A private thread between bots. You can read along."

  return (
    <header className="drag flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-line px-4">
      <div className="no-drag flex min-w-0 items-center gap-2.5">
        {bot ? <BotAvatar bot={bot} size="md" working={working} /> : thread.kind === "group" ? <GroupAvatar bots={bots} size="md" /> : <AvatarStack bots={bots} size="sm" />}
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold leading-tight tracking-[-0.01em]">{title}</p>
          <p className={cn("truncate text-[12px] leading-tight", working ? "text-accent" : "text-faint")}>{subtitle}</p>
        </div>
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
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ resize: "smooth", initial: "instant" })

  const thread = threads.data?.find((t) => t.id === threadId)
  const byId = useMemo(() => new Map((bots.data ?? []).map((b) => [b.id, b])), [bots.data])
  const members = (thread?.botIds ?? []).map((id) => byId.get(id)).filter(Boolean) as Bot[]
  const layout: ChatLayout = thread?.kind === "direct" ? "direct" : thread?.kind === "group" ? "group" : "bot"
  const title = thread?.kind === "direct" ? (members[0]?.name ?? "Chat") : thread?.kind === "group" ? (thread.name ?? "Group") : members.map((m) => m.name).join(" ↔ ")
  const pendingTakeovers = (takeovers.data ?? []).filter((t) => t.threadId === threadId)
  // Anyone on the team can be @mentioned; a bot that isn't here gets a message from the one who answers
  const mentionable = (bots.data ?? []).filter((b) => b.status !== "hidden" && !(thread?.kind === "direct" && b.id === members[0]?.id))

  // Mark as read when opened and when new messages arrive while open
  useEffect(() => {
    if (!thread?.unread) return
    void api(`/threads/${threadId}/read`, { method: "POST" }).then(() => queryClient.invalidateQueries({ queryKey: keys.threads }))
  }, [threadId, thread?.unread, messages.data?.length])

  // Pick up turns that were already running when the thread opened
  useEffect(() => {
    for (const r of thread?.activeRuns ?? []) if (r.triggerRunId) liveRuns.add(threadId, r)
  }, [threadId, thread?.activeRuns])

  const send = useAction((msg: ComposerSend) =>
    api<{ message: StoredMessage; runs: ActiveRun[]; routedReason: string | null }>(`/threads/${threadId}/messages`, { body: msg }),
  )

  const onSend = async (msg: ComposerSend) => {
    void scrollToBottom()
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
  const shown = stored.filter((m) => !liveMessageIds.has(m.id))
  const relayedOf = (m: StoredMessage | undefined) => (m?.metadata as { via?: string } | null)?.via === "bot_message"

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <ThreadHeader
          thread={thread}
          bots={members}
          title={title}
          working={live.length > 0}
          screenOpen={screen.open}
          onScreen={() => setScreen((s) => ({ open: !s.open, botId: s.botId }))}
        />
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="h-full overflow-y-auto">
            <div ref={contentRef} className={cn("pb-6", !shown.length && !live.length && "h-full")}>
              {!shown.length && !live.length ? (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="max-w-sm text-center">
                    {thread.kind === "direct" && members[0] ? (
                      <>
                        <BotAvatar bot={members[0]} size="xl" className="mx-auto" />
                        <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{members[0].name}</h2>
                        <p className="mt-1 text-[13px] text-muted">{members[0].job}</p>
                        <p className="mt-5 text-[12.5px] leading-relaxed text-faint">
                          Ask for something. It works on its own screen, uses the apps you connected, and can bring in a teammate when you type @.
                        </p>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex justify-center">
                          {thread.kind === "group" ? <GroupAvatar bots={members} size="lg" className="size-16" /> : <AvatarStack bots={members} max={6} size="md" />}
                        </span>
                        <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
                        <p className="mt-1 text-[13px] text-muted">
                          {thread.kind === "group" ? "Write to the group and the right bot answers. Type @ to pick one." : "These two haven't messaged each other yet."}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-3xl pt-3">
                  {shown.map((m, i) => {
                    const prev = shown[i - 1]
                    const relayed = relayedOf(m)
                    const gap = prev ? new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity
                    const grouped =
                      !!prev && prev.authorType === m.authorType && prev.authorId === m.authorId && m.authorType !== "system" &&
                      relayedOf(prev) === relayed && gap < 5 * 60_000
                    // A run of answers relayed from other bots opens with a divider naming them
                    let divider = null
                    if (relayed && !relayedOf(prev) && layout !== "bot") {
                      const run: StoredMessage[] = []
                      for (let j = i; j < shown.length && relayedOf(shown[j]); j++) run.push(shown[j]!)
                      const authors = [...new Set(run.map((r) => r.authorId ?? ""))].map((id) => byId.get(id))
                      divider = <BotMessagesDivider authors={authors} threadId={(m.metadata as { botThreadId?: string }).botThreadId} />
                    }
                    const author =
                      m.authorType === "user"
                        ? ({ kind: "user", name: "You" } as const)
                        : m.authorType === "bot"
                          ? ({ kind: "bot", bot: byId.get(m.authorId ?? "") } as const)
                          : ({ kind: "system" } as const)
                    return (
                      <div key={m.id}>
                        {divider}
                        <Message
                          id={m.id}
                          author={author}
                          parts={m.parts}
                          metadata={m.metadata}
                          createdAt={m.createdAt}
                          layout={layout}
                          grouped={grouped && !divider}
                          showStamp={gap > 30 * 60_000}
                          addressedTo={layout === "bot" || relayed ? byId.get(m.addressedToBotId ?? "") : undefined}
                          approvals={approvals.data}
                        />
                      </div>
                    )
                  })}
                  {live.map((r) => (
                    <LiveReply
                      key={r.triggerRunId}
                      run={r}
                      bot={byId.get(r.botId)}
                      layout={layout}
                      onMessageId={(id) => setLiveIds((s) => (s[r.triggerRunId] === id ? s : { ...s, [r.triggerRunId]: id }))}
                    />
                  ))}
                  {pendingTakeovers.map((t) => (
                    <div key={t.id} className="px-5 pt-2">
                      <TakeoverCard takeover={t} onOpenScreen={() => setScreen({ open: true, botId: t.botId, control: true })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {!isAtBottom ? (
            <button
              onClick={() => void scrollToBottom()}
              className="absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-panel text-muted shadow-pop transition-colors hover:text-fg animate-fade-in"
              aria-label="Jump to latest"
            >
              <ArrowDown className="size-4" />
            </button>
          ) : null}
        </div>
        {thread.kind !== "bot" ? (
          <div className="mx-auto w-full max-w-3xl">
            <Composer
              mentionable={mentionable}
              memberIds={thread.kind === "group" ? thread.botIds : undefined}
              placeholder={thread.kind === "direct" ? `Message ${members[0]?.name ?? ""}` : `Message ${title}`}
              working={live.length > 0}
              onSend={onSend}
              onStop={stop}
            />
          </div>
        ) : (
          <div className="px-4 pb-4 pt-2">
            <p className="mx-auto max-w-3xl rounded-[22px] border border-dashed border-line px-4 py-3 text-center text-[12.5px] text-faint">
              {me.data ? "This is between bots. Message one of them directly to step in." : null}
            </p>
          </div>
        )}
      </div>
      {screen.open ? (
        <ScreenPanel bots={members} initialBotId={screen.botId ?? live[0]?.botId} controlRequested={screen.control} onClose={() => setScreen({ open: false })} />
      ) : null}
    </div>
  )
}
