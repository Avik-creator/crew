import RFB from "@novnc/novnc"
import { Clock, Hand, Laptop, Maximize2, MonitorOff, Pause, Pencil, Plus, RefreshCw, X } from "lucide-react"
import { Dialog as D, Tabs } from "radix-ui"
import { useEffect, useRef, useState } from "react"
import { Link } from "wouter"

import { api, serverBase } from "@/lib/api"
import { useMe, useSchedules } from "@/lib/queries"
import { useUI } from "@/lib/ui"
import { describeSchedule } from "@/routes/schedules"
import type { Bot } from "@/lib/types"
import { cn, errorMessage } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { ResizeHandle, useColumnWidth } from "./resize-handle"
import { Button } from "./ui/button"
import { Switch, Tip } from "./ui/misc"
import { Spinner } from "./ui/spinner"

type State = { kind: "connecting"; slow: boolean } | { kind: "live" } | { kind: "error"; message: string } | { kind: "closed" }

// A bot's display on the cloud computer, streamed over VNC through the server.
// View-only by default; "Take control" lets the person use it directly.
function CloudScreen({ bot, control, compact, className }: { bot: Bot; control: boolean; compact?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [state, setState] = useState<State>({ kind: "connecting", slow: false })
  const [attempt, setAttempt] = useState(0)
  // A slow connect only means a cold start when the computer wasn't running
  const asleep = useMe().data?.computer.status !== "running"

  useEffect(() => {
    let cancelled = false
    setState({ kind: "connecting", slow: false })
    const slow = setTimeout(() => !cancelled && setState((s) => (s.kind === "connecting" ? { kind: "connecting", slow: true } : s)), 4000)
    void (async () => {
      try {
        const { path, password } = await api<{ path: string; password: string }>(`/bots/${bot.id}/screen-ticket`, { method: "POST" })
        if (cancelled || !ref.current) return
        const conn = new RFB(ref.current, `${serverBase().replace(/^http/, "ws")}${path}`, {
          credentials: { password },
          wsProtocols: ["binary"],
        })
        conn.scaleViewport = true
        conn.resizeSession = false
        conn.background = "transparent"
        conn.qualityLevel = 6
        conn.viewOnly = !control
        conn.addEventListener("connect", () => setState({ kind: "live" }))
        conn.addEventListener("disconnect", () => setState((s) => (s.kind === "error" ? s : { kind: "closed" })))
        conn.addEventListener("securityfailure", () => setState({ kind: "error", message: "The screen refused the connection." }))
        rfb.current = conn
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: errorMessage(err) })
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(slow)
      rfb.current?.disconnect()
      rfb.current = null
    }
  }, [bot.id, attempt])

  useEffect(() => {
    if (rfb.current) rfb.current.viewOnly = !control
    if (control) rfb.current?.focus()
  }, [control])

  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-line bg-black/90", className)}>
      {/* noVNC stops every click on its canvas, even view-only. Without control the
          canvas lets clicks through, so the preview around it can open the large view. */}
      <div ref={ref} className={cn("absolute inset-0 [&_canvas]:!cursor-default", control ? "[&_canvas]:!cursor-auto" : "pointer-events-none")} />
      {state.kind !== "live" ? (
        <div className="absolute inset-0 grid place-items-center bg-panel/90 text-center">
          <div className="max-w-xs px-6">
            {state.kind === "connecting" ? (
              <>
                <Spinner className="mx-auto size-5 text-muted" />
                <p className="mt-3 text-[13px] font-medium">{state.slow && asleep ? "Starting the computer…" : "Connecting…"}</p>
                {state.slow && asleep && !compact ? <p className="mt-1 text-[12px] text-muted">The first start takes up to a minute. After that it wakes in about a second.</p> : null}
              </>
            ) : (
              <>
                <MonitorOff className="mx-auto size-5 text-muted" />
                <p className="mt-3 text-[13px] font-medium">{state.kind === "closed" ? "Screen disconnected" : "Couldn't open the screen"}</p>
                {state.kind === "error" && !compact ? <p className="mt-1 text-[12px] text-muted">{state.message}</p> : null}
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={(e) => {
                    e.stopPropagation()
                    setAttempt((a) => a + 1)
                  }}
                >
                  <RefreshCw /> Try again
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {control && state.kind === "live" ? (
        <div className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-accent" />
      ) : null}
    </div>
  )
}

// The bot's screen, large, for watching closely or taking control
function ScreenViewer({
  bot,
  open,
  onOpenChange,
  control,
  onControl,
}: {
  bot: Bot
  open: boolean
  onOpenChange: (open: boolean) => void
  control: boolean
  onControl: (v: boolean) => void
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        {/* no-drag: Electron's window-drag strips under the headers would otherwise eat clicks on the top of the dialog */}
        <D.Overlay className="no-drag fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] animate-fade-in" />
        <D.Content className="no-drag fixed inset-6 z-50 flex flex-col rounded-2xl border border-line bg-panel p-3 shadow-pop outline-none animate-fade-in">
          <div className="flex items-center justify-between gap-3 px-1 pb-3">
            <D.Title className="flex items-center gap-2 text-[14px] font-semibold">
              <BotAvatar bot={bot} size="sm" /> {bot.name}’s screen
            </D.Title>
            <D.Description className="sr-only">Live view of {bot.name}’s screen on the cloud computer</D.Description>
            <div className="flex items-center gap-3">
              <Tip label={control ? "You're in control. The bot can still act." : "Use the screen yourself"}>
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  <Hand className="size-3.5" /> Take control
                  <Switch checked={control} onCheckedChange={onControl} />
                </label>
              </Tip>
              <D.Close asChild>
                <Button size="icon-sm" variant="ghost" aria-label="Close">
                  <X />
                </Button>
              </D.Close>
            </div>
          </div>
          <CloudScreen bot={bot} control={control} className="min-h-0 flex-1" />
          <p className="pt-2 text-center text-[11px] text-faint">Shared cloud computer · logins and files are shared by all bots</p>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

function Routines({ bot }: { bot: Bot }) {
  const schedules = useSchedules()
  const mine = (schedules.data ?? []).filter((s) => s.botId === bot.id)
  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[12px] text-faint">{mine.length ? `${mine.length} scheduled` : "Nothing scheduled yet"}</p>
        <Tip label="New routine">
          <Button size="icon-sm" asChild aria-label="New routine">
            <Link href="/schedules">
              <Plus />
            </Link>
          </Button>
        </Tip>
      </div>
      {mine.length ? (
        <ul className="flex flex-col">
          {mine.map((s) => (
            <li key={s.id}>
              <Link href="/schedules" className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-hover">
                {s.enabled ? <Clock className="size-4 shrink-0 text-ok" /> : <Pause className="size-4 shrink-0 text-muted" />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[15px] font-medium", !s.enabled && "text-muted")}>{s.name}</span>
                  <span className="block truncate text-[13px] text-muted/80">{describeSchedule(s)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">Ask {bot.name} or your main assistant to do something every day or every week.</p>
      )}
    </section>
  )
}

const tab =
  "flex-1 rounded-md px-2 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:bg-bg data-[state=active]:text-fg data-[state=active]:shadow-sm dark:data-[state=active]:bg-hover"

// The right-hand panel, after Rakazo's bot panel: who the bot is, then tabs for
// its computer and its routines. The live preview opens large on a click.
export function ScreenPanel({ bots, initialBotId, onClose, controlRequested }: { bots: Bot[]; initialBotId?: string; onClose: () => void; controlRequested?: boolean }) {
  const ui = useUI()
  const [selected, setSelected] = useState(initialBotId ?? bots[0]?.id)
  const [expanded, setExpanded] = useState(!!controlRequested)
  const [control, setControl] = useState(!!controlRequested)
  const { width, setWidth } = useColumnWidth("crew:panel-width", 384, 320, 640)
  const bot = bots.find((b) => b.id === selected) ?? bots[0]

  useEffect(() => {
    if (initialBotId) setSelected(initialBotId)
  }, [initialBotId])
  useEffect(() => {
    if (controlRequested) {
      setControl(true)
      setExpanded(true)
    }
  }, [controlRequested])

  if (!bot) return null

  return (
    <aside className="relative flex h-full shrink-0 flex-col border-l border-fg/[0.06] bg-bg" style={{ width }}>
      <ResizeHandle side="start" width={width} onWidth={setWidth} label="Resize panel" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-[17px]">
        <div className="mb-4 flex items-center justify-between gap-2">
          {bots.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Which bot">
              {bots.map((b) => (
                <Tip key={b.id} label={b.name}>
                  <button
                    role="tab"
                    aria-selected={b.id === bot.id}
                    onClick={() => setSelected(b.id)}
                    className={cn("rounded-full p-0.5 transition-opacity", b.id === bot.id ? "ring-2 ring-fg/70" : "opacity-60 hover:opacity-100")}
                  >
                    <BotAvatar bot={b} size="sm" />
                  </button>
                </Tip>
              ))}
            </div>
          ) : (
            <span />
          )}
          <Tip label="Close">
            <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close panel">
              <X className="size-4!" strokeWidth={1.8} />
            </Button>
          </Tip>
        </div>

        <div className="flex flex-col items-center pb-5 text-center">
          <BotAvatar bot={bot} size="xl" className="size-[76px]" />
          <h2 className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.012em]">{bot.name}</h2>
          <p className="mt-0.5 line-clamp-2 max-w-[90%] text-[13px] text-muted">{bot.job}</p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => ui.editBot(bot)}>
            <Pencil /> Edit
          </Button>
        </div>

        <Tabs.Root defaultValue="computer">
          <Tabs.List className="flex h-8 w-full rounded-lg bg-raised p-[3px]" aria-label={`${bot.name}’s details`}>
            <Tabs.Trigger value="computer" className={tab}>
              Computer
            </Tabs.Trigger>
            <Tabs.Trigger value="routines" className={tab}>
              Routines
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="computer" className="pt-4 outline-none">
            {bot.runsOn === "cloud" ? (
              <>
                {/* A div, not a button: the preview can hold its own "Try again" button */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setExpanded(true)
                    }
                  }}
                  className="group relative block aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-[14px] bg-black text-left"
                  aria-label={`Open ${bot.name}’s screen`}
                >
                  {/* One live connection at a time: the preview steps aside while the large view is open */}
                  {expanded ? (
                    <div className="absolute inset-0 grid place-items-center bg-raised text-[12px] text-faint">Open in the large view</div>
                  ) : (
                    <CloudScreen key={bot.id} bot={bot} control={false} compact className="absolute inset-0 rounded-[14px] border-0" />
                  )}
                  <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="flex items-center gap-1.5 rounded-full bg-bg px-3.5 py-2 text-[14px] text-fg shadow-md">
                      <Maximize2 className="size-3.5" /> Open
                    </span>
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="truncate text-[14px] text-muted">{bot.name}’s screen</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => {
                      setControl(true)
                      setExpanded(true)
                    }}
                  >
                    <Hand /> Take control
                  </Button>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-faint">Shared cloud computer. Logins and files are shared by all your bots.</p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-[14px] bg-raised/60 px-6 py-7 text-center">
                <Laptop className="size-5 text-muted" />
                <p className="text-[13px] text-muted">Works on your Mac. A purple frame shows while it’s in control; ⌘⇧Esc stops it.</p>
              </div>
            )}
          </Tabs.Content>
          <Tabs.Content value="routines" className="pt-4 outline-none">
            <Routines bot={bot} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
      {bot.runsOn === "cloud" ? (
        <ScreenViewer
          bot={bot}
          open={expanded}
          onOpenChange={(open) => {
            setExpanded(open)
            if (!open) setControl(false)
          }}
          control={control}
          onControl={setControl}
        />
      ) : null}
    </aside>
  )
}
