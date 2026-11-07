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
import { ChiefAvatar } from "@/components/sidebar"
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
import { cn, errorMessage, startsStretch } from "@/lib/utils"

function LiveReply({ run, bot, layout, onMessageId }: { run: ActiveRun; bot: Bot | undefined; layout: ChatLayout; onMessageId: (id: string | null) => void }) {
  const message = useLiveMessage(run.runId)
  const approvals = useApprovals()
  useEffect(() => onMessageId(message?.id ?? null), [message?.id, onMessageId])
  return (
    <Message
      id={message?.id ?? run.runId}
      author={{ kind: "bot", bot }}
      parts={message?.parts ?? []}
      streaming
      layout={layout}
      approvals={approvals.data}
    />
  )
}

const CHIEF_STARTERS = [
  "Set up a bot that keeps my inbox at zero",
  "Build a small team that researches competitors and writes me a weekly brief",
  "Which bots would help with my job? Ask me a few questions first",
]

// The main assistant's empty chat: what it does, and a few ways to start
function ChiefIntro({ bot, onPick }: { bot: Bot; onPick: (text: string) => void }) {
  return (
    <>
      <span className="inline-flex">
        <ChiefAvatar bot={bot} size="xl" />
      </span>
      <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">{bot.name}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        Tell me what you need help with. I'll set up the right bots, put them in groups, and get them working.
      </p>
      <div className="mt-6 flex flex-col gap-2">
        {CHIEF_STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-2xl border border-line px-3.5 py-2.5 text-left text-[13px] text-fg transition-colors hover:border-line-strong hover:bg-hover"
          >
            {s}
          </button>
        ))}
      </div>
    </>
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

  const floating = "border border-line bg-raised/90 text-fg/75 backdrop-blur transition-colors hover:bg-hover hover:text-fg"

  // Floats over the transcript, after Rakazo: the conversation's name is a pill
  // that opens the bot panel, and the window drags from a thin strip above it
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-[22px] py-[13px]">
      <div className="absolute inset-x-0 top-0 -z-10 h-[76px] bg-linear-to-b from-bg via-bg/80 to-transparent" />
      <div className="drag pointer-events-auto absolute inset-x-0 top-0 h-3" />
      <span />
      <Tip label={screenOpen ? "Hide details" : bots.length ? "Screen and routines" : title}>
        <button
          onClick={onScreen}
          className={cn("no-drag pointer-events-auto flex min-w-0 items-center gap-2 rounded-full py-1 ps-1 pe-3.5", floating, screenOpen && "bg-hover text-fg")}
          aria-expanded={screenOpen}
        >
          {bot ? (
            bot.role === "chief" ? <ChiefAvatar bot={bot} working={working} /> : <BotAvatar bot={bot} size="sm" working={working} className="size-[26px]" />
          ) : thread.kind === "group" ? <GroupAvatar bots={bots} size="sm" /> : <AvatarStack bots={bots} size="xs" />}
          <span className="truncate text-[15px] font-medium text-fg">{title}</span>
          {working ? <span className="size-1.5 shrink-0 rounded-full bg-working animate-pulse-soft" aria-label="Working" /> : null}
          {bot?.status === "paused" ? <span className="shrink-0 text-[12px] text-faint">Paused</span> : null}
        </button>
      </Tip>
      <div className="no-drag pointer-events-auto flex items-center justify-end gap-1.5">
        <Menu>
          <MenuTrigger asChild>
            <button className={cn("grid size-9 place-items-center rounded-full", floating)} aria-label="More">
              <Ellipsis className="size-[17px]" strokeWidth={1.6} />
            </button>
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
                  const ask =
                    bot.role === "chief"
                      ? `Remove ${bot.name}? Its chat goes too. You can bring it back in Settings.`
                      : `Delete ${bot.name}? Its chat and notes are removed.`
                  if (confirm(ask)) removeBot.mutate(undefined, { onSuccess: () => navigate("/") })
                }}
              >
                <Trash /> {bot.role === "chief" ? "Remove assistant" : "Delete bot"}
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
  // The bot panel stays open or closed per conversation, like Rakazo's right panel
  const panelKey = `crew:panel:${threadId}`
  const [screen, setScreenState] = useState<{ open: boolean; botId?: string; control?: boolean }>(() => {
    try {
      return { open: localStorage.getItem(panelKey) === "1" }
    } catch {
      return { open: false }
    }
  })
  const setScreen = (next: typeof screen | ((s: typeof screen) => typeof screen)) =>
    setScreenState((s) => {
      const value = typeof next === "function" ? next(s) : next
      try {
        localStorage.setItem(panelKey, value.open ? "1" : "0")
      } catch {
        // private storage: the choice just isn't remembered
      }
      return value
    })
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
    for (const r of thread?.activeRuns ?? []) liveRuns.add(threadId, r)
  }, [threadId, thread?.activeRuns])

  const send = useAction((msg: ComposerSend) =>
    api<{ message: StoredMessage; runs: ActiveRun[]; routedReason: string | null }>(`/threads/${threadId}/messages`, { body: msg }),
  )

  // Your message shows the moment you send it; the saved copy replaces it
  const onSend = async (msg: ComposerSend) => {
    const key = keys.messages(threadId)
    const draft: StoredMessage = {
      id: `draft-${crypto.randomUUID()}`,
      threadId,
      role: "user",
      authorType: "user",
      authorId: me.data?.user.id ?? null,
      parts: [
        { type: "text", text: msg.text },
        ...msg.images.map((img) => ({ type: "file" as const, mediaType: img.mediaType, url: `data:${img.mediaType};base64,${img.base64}` })),
      ],
      metadata: { mentionBotIds: msg.mentionBotIds },
      createdAt: new Date().toISOString(),
    }
    // A refetch already in flight would land without the draft and blink it away
    await queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData<StoredMessage[]>(key, (old) => [...(old ?? []), draft])
    void scrollToBottom()
    try {
      const res = await send.mutateAsync(msg)
      queryClient.setQueryData<StoredMessage[]>(key, (old) => {
        const list = (old ?? []).filter((m) => m.id !== draft.id)
        return list.some((m) => m.id === res.message.id) ? list : [...list, res.message]
      })
      for (const r of res.runs) liveRuns.add(threadId, r)
      if (!res.runs.length) toast("Nobody's available to answer. Resume a paused bot or add one to the group.")
    } catch (err) {
      queryClient.setQueryData<StoredMessage[]>(key, (old) => (old ?? []).filter((m) => m.id !== draft.id))
      toast.error(errorMessage(err))
    }
  }

  const stop = async () => {
    await Promise.all(live.map((r) => api(`/runs/${r.runId}/cancel`, { method: "POST" }).catch(() => {})))
    for (const r of live) liveRuns.remove(threadId, r.runId)
  }

  if (!thread) {
    return threads.isLoading ? null : <EmptyState icon={<Users />} title="Conversation not found" body="It may have been deleted." />
  }

  const stored = messages.data ?? []
  // A finished run leaves its id in liveIds. Only a run still on screen should hide the saved row.
  const liveMessageIds = new Set(live.flatMap((r) => {
    const id = liveIds[r.runId]
    return id ? [id] : []
  }))
  const shown = stored.filter((m) => !liveMessageIds.has(m.id))
  const relayedOf = (m: StoredMessage | undefined) => (m?.metadata as { via?: string } | null)?.via === "bot_message"

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
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
            <div ref={contentRef} className={cn("pb-12", !shown.length && !live.length && "h-full")}>
              {!shown.length && !live.length ? (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="max-w-sm text-center">
                    {thread.kind === "direct" && members[0]?.role === "chief" ? (
                      <ChiefIntro bot={members[0]} onPick={(text) => void onSend({ text, mentionBotIds: [], images: [] })} />
                    ) : thread.kind === "direct" && members[0] ? (
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
                <div className="px-[max(1.75rem,calc((100%-60rem)/2))] pt-[72px]">
                  {shown.map((m, i) => {
                    const prev = shown[i - 1]
                    const relayed = relayedOf(m)
                    const gap = prev ? new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity
                    const grouped =
                      !!prev && prev.authorType === m.authorType && prev.authorId === m.authorId && m.authorType !== "system" &&
                      relayedOf(prev) === relayed && gap < 5 * 60_000
                    // Answers relayed from other bots are for the bot that asked, which
                    // sums them up. The person sees one line naming who replied.
                    if (relayed && layout !== "bot") {
                      if (relayedOf(prev)) return null
                      const run: StoredMessage[] = []
                      for (let j = i; j < shown.length && relayedOf(shown[j]); j++) run.push(shown[j]!)
                      const authors = [...new Set(run.map((r) => r.authorId ?? ""))].map((id) => byId.get(id))
                      return <BotMessagesDivider key={m.id} authors={authors} />
                    }
                    const author =
                      m.authorType === "user"
                        ? ({ kind: "user", name: "You" } as const)
                        : m.authorType === "bot"
                          ? ({ kind: "bot", bot: byId.get(m.authorId ?? "") } as const)
                          : ({ kind: "system" } as const)
                    return (
                      <div key={m.id}>
                        <Message
                          id={m.id}
                          author={author}
                          parts={m.parts}
                          metadata={m.metadata}
                          createdAt={m.createdAt}
                          layout={layout}
                          grouped={grouped}
                          showStamp={startsStretch(m.createdAt, prev?.createdAt)}
                          addressedTo={layout === "bot" || relayed ? byId.get(m.addressedToBotId ?? "") : undefined}
                          approvals={approvals.data}
                        />
                      </div>
                    )
                  })}
                  {send.isPending && !live.length ? (
                    // Typing dots while the bot is being started, so the wait starts right away
                    <Message id="pending" author={{ kind: "bot", bot: thread.kind === "direct" ? members[0] : undefined }} parts={[]} streaming layout="direct" />
                  ) : null}
                  {live.map((r) => (
                    <LiveReply
                      key={r.runId}
                      run={r}
                      bot={byId.get(r.botId)}
                      layout={layout}
                      onMessageId={(id) => setLiveIds((s) => (s[r.runId] === id ? s : { ...s, [r.runId]: id }))}
                    />
                  ))}
                  {pendingTakeovers.map((t) => (
                    <div key={t.id} className="pt-2">
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
              className="absolute bottom-11 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-raised/90 text-fg/75 shadow-md backdrop-blur transition-colors hover:bg-hover hover:text-fg animate-fade-in"
              aria-label="Jump to latest"
            >
              <ArrowDown className="size-4" />
            </button>
          ) : null}
        </div>
        {thread.kind !== "bot" ? (
          // Overlaps the transcript a little, so messages scroll under its rounded top
          <div className="relative z-10 -mt-7 px-[max(1.5rem,calc((100%-60rem)/2))]">
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
          <div className="px-[max(1.5rem,calc((100%-60rem)/2))] pb-5 pt-2">
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
