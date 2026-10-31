import RFB from "@novnc/novnc"
import { Hand, Laptop, MonitorOff, RefreshCw, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { api, serverBase } from "@/lib/api"
import type { Bot } from "@/lib/types"
import { cn, errorMessage } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { Button } from "./ui/button"
import { Switch, Tip } from "./ui/misc"
import { Spinner } from "./ui/spinner"

type State = { kind: "connecting"; slow: boolean } | { kind: "live" } | { kind: "error"; message: string } | { kind: "closed" }

// A bot's display on the cloud computer, streamed over VNC through the server.
// View-only by default; "Take control" lets the person use it directly.
function CloudScreen({ bot, control }: { bot: Bot; control: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const rfb = useRef<RFB | null>(null)
  const [state, setState] = useState<State>({ kind: "connecting", slow: false })
  const [attempt, setAttempt] = useState(0)

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
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-black/90">
      <div ref={ref} className={cn("absolute inset-0 [&_canvas]:!cursor-default", control && "[&_canvas]:!cursor-auto")} />
      {state.kind !== "live" ? (
        <div className="absolute inset-0 grid place-items-center bg-panel/90 text-center">
          <div className="max-w-xs px-6">
            {state.kind === "connecting" ? (
              <>
                <Spinner className="mx-auto size-5 text-muted" />
                <p className="mt-3 text-[13px] font-medium">{state.slow ? "Starting the computer…" : "Connecting…"}</p>
                {state.slow ? <p className="mt-1 text-[12px] text-muted">The first start takes up to a minute. After that it wakes in about a second.</p> : null}
              </>
            ) : (
              <>
                <MonitorOff className="mx-auto size-5 text-muted" />
                <p className="mt-3 text-[13px] font-medium">{state.kind === "closed" ? "Screen disconnected" : "Couldn't open the screen"}</p>
                {state.kind === "error" ? <p className="mt-1 text-[12px] text-muted">{state.message}</p> : null}
                <Button size="sm" className="mt-3" onClick={() => setAttempt((a) => a + 1)}>
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

export function ScreenPanel({ bots, initialBotId, onClose, controlRequested }: { bots: Bot[]; initialBotId?: string; onClose: () => void; controlRequested?: boolean }) {
  const cloud = bots.filter((b) => b.runsOn === "cloud")
  const [selected, setSelected] = useState(initialBotId ?? bots[0]?.id)
  const [control, setControl] = useState(!!controlRequested)
  const bot = bots.find((b) => b.id === selected) ?? bots[0]

  useEffect(() => {
    if (initialBotId) setSelected(initialBotId)
  }, [initialBotId])
  useEffect(() => {
    if (controlRequested) setControl(true)
  }, [controlRequested])

  return (
    <aside className="flex h-full w-[min(46vw,640px)] shrink-0 flex-col border-l border-line bg-panel/40">
      <div className="drag flex h-[52px] shrink-0 items-center justify-between gap-2 px-3">
        <div className="no-drag flex items-center gap-1 overflow-x-auto">
          {bots.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelected(b.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-2.5 text-[12.5px] transition-colors",
                b.id === bot?.id ? "bg-hover font-medium text-fg" : "text-muted hover:bg-hover/60",
              )}
            >
              <BotAvatar bot={b} size="xs" />
              {b.name}
            </button>
          ))}
        </div>
        <div className="no-drag flex items-center gap-2">
          {bot?.runsOn === "cloud" ? (
            <Tip label={control ? "You're in control. The bot can still act." : "Use the screen yourself"}>
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <Hand className="size-3.5" /> Take control
                <Switch checked={control} onCheckedChange={setControl} />
              </label>
            </Tip>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close screen">
            <X />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        {bot && bot.runsOn === "cloud" ? (
          <CloudScreen key={bot.id} bot={bot} control={control} />
        ) : (
          <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-line text-center">
            <div className="max-w-xs px-6">
              <Laptop className="mx-auto size-5 text-muted" />
              <p className="mt-3 text-[13px] font-medium">{bot?.name ?? "This bot"} works on your Mac</p>
              <p className="mt-1 text-[12px] text-muted">You'll see a purple frame around your screen while it's in control. Press ⌘⇧Esc to stop it.</p>
            </div>
          </div>
        )}
        {cloud.length ? <p className="mt-2 text-center text-[11px] text-faint">Shared cloud computer · logins and files are shared by all bots</p> : null}
      </div>
    </aside>
  )
}
