import { CalendarClock, Pencil, Play, Plus, Trash } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { BotAvatar } from "@/components/bot-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, Input, Textarea } from "@/components/ui/input"
import { EmptyState, PageHeader, Switch } from "@/components/ui/misc"
import { Select } from "@/components/ui/select"
import { api } from "@/lib/api"
import { keys, useAction, useBots, useMe, useSchedules } from "@/lib/queries"
import type { Schedule } from "@/lib/types"
import { ago, errorMessage } from "@/lib/utils"

type Repeat = "daily" | "weekdays" | "weekly" | "hourly" | "custom" | "once"

const toCron = (repeat: Repeat, time: string, day: string, custom: string) => {
  const [h, m] = time.split(":").map(Number)
  if (repeat === "hourly") return `${m ?? 0} * * * *`
  if (repeat === "daily") return `${m} ${h} * * *`
  if (repeat === "weekdays") return `${m} ${h} * * 1-5`
  if (repeat === "weekly") return `${m} ${h} * * ${day}`
  return custom
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

// Turns common cron shapes back into words
export function describeSchedule(s: Pick<Schedule, "cron" | "runAt">) {
  if (s.runAt) return `Once, ${new Date(s.runAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
  const parts = (s.cron ?? "").split(" ")
  if (parts.length !== 5) return s.cron ?? ""
  const [m, h, dom, mon, dow] = parts
  const at = h !== "*" ? new Date(2000, 0, 1, Number(h), Number(m)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""
  if (h === "*" && dom === "*" && dow === "*") return `Every hour at :${m!.padStart(2, "0")}`
  if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${at}`
  if (dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${at}`
  if (dom === "*" && mon === "*" && /^\d$/.test(dow!)) return `Every ${DAYS[Number(dow)]} at ${at}`
  return s.cron ?? ""
}

function ScheduleDialog({ open, onOpenChange, schedule }: { open: boolean; onOpenChange: (v: boolean) => void; schedule?: Schedule }) {
  const bots = useBots()
  const me = useMe()
  const [botId, setBotId] = useState<string>()
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [repeat, setRepeat] = useState<Repeat>("daily")
  const [time, setTime] = useState("09:00")
  const [day, setDay] = useState("1")
  const [custom, setCustom] = useState("0 9 * * *")
  const [runAt, setRunAt] = useState("")

  useEffect(() => {
    if (!open) return
    setBotId(schedule?.botId ?? bots.data?.[0]?.id)
    setName(schedule?.name ?? "")
    setPrompt(schedule?.prompt ?? "")
    setRepeat(schedule ? (schedule.runAt ? "once" : "custom") : "daily")
    setCustom(schedule?.cron ?? "0 9 * * *")
    setRunAt(schedule?.runAt ? schedule.runAt.slice(0, 16) : "")
  }, [open, schedule, bots.data])

  const save = useAction(() => {
    const body = {
      botId,
      name,
      prompt,
      timeZone: me.data?.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      cron: repeat === "once" ? null : toCron(repeat, time, day, custom),
      runAt: repeat === "once" ? new Date(runAt).toISOString() : null,
      enabled: schedule?.enabled ?? true,
    }
    return schedule ? api(`/schedules/${schedule.id}`, { method: "PATCH", body }) : api("/schedules", { body })
  }, [keys.schedules])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={schedule ? "Edit schedule" : "New schedule"}
        description="A bot does this on its own and posts the result in its chat."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!botId || !name || !prompt || (repeat === "once" && !runAt)}
              loading={save.isPending}
              onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => toast.error(errorMessage(e)) })}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Bot">
            <Select value={botId} onValueChange={setBotId} options={(bots.data ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning inbox sweep" />
          </Field>
          <Field label="What to do">
            <Textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Check my inbox, draft replies to anything urgent, and give me a short summary." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Repeat">
              <Select
                value={repeat}
                onValueChange={(v) => setRepeat(v as Repeat)}
                options={[
                  { value: "daily", label: "Every day" },
                  { value: "weekdays", label: "Weekdays" },
                  { value: "weekly", label: "Every week" },
                  { value: "hourly", label: "Every hour" },
                  { value: "once", label: "Once" },
                  { value: "custom", label: "Custom (cron)" },
                ]}
              />
            </Field>
            {repeat === "once" ? (
              <Field label="When">
                <Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} />
              </Field>
            ) : repeat === "custom" ? (
              <Field label="Cron">
                <Input className="font-mono" value={custom} onChange={(e) => setCustom(e.target.value)} />
              </Field>
            ) : (
              <Field label={repeat === "hourly" ? "Minute" : "Time"}>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </Field>
            )}
          </div>
          {repeat === "weekly" ? (
            <Field label="Day">
              <Select value={day} onValueChange={setDay} options={DAYS.map((d, i) => ({ value: String(i), label: d }))} />
            </Field>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SchedulesRoute() {
  const schedules = useSchedules()
  const bots = useBots()
  const [editing, setEditing] = useState<{ open: boolean; schedule?: Schedule }>({ open: false })
  const toggle = useAction((s: Schedule) => api(`/schedules/${s.id}`, { method: "PATCH", body: { ...s, enabled: !s.enabled } }), [keys.schedules])
  const remove = useAction((id: string) => api(`/schedules/${id}`, { method: "DELETE" }), [keys.schedules])
  const runNow = useAction((id: string) => api(`/schedules/${id}/run`, { method: "POST" }))
  const byId = new Map((bots.data ?? []).map((b) => [b.id, b]))

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Schedules"
        description="Routines your bots run on their own, even when this app is closed."
        actions={<Button size="sm" onClick={() => setEditing({ open: true })} disabled={!bots.data?.length}><Plus /> New schedule</Button>}
      />
      <div className="mx-auto max-w-3xl px-8 py-5">
        {!schedules.data?.length ? (
          <EmptyState
            icon={<CalendarClock />}
            title="No schedules yet"
            body="Try a morning inbox sweep, a weekly report, or a nightly check of your open pull requests."
            action={bots.data?.length ? <Button variant="primary" onClick={() => setEditing({ open: true })}><Plus /> New schedule</Button> : undefined}
          />
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-panel">
            {schedules.data.map((s) => (
              <div key={s.id} className="group flex items-center gap-3 p-3.5">
                <BotAvatar bot={byId.get(s.botId)} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{s.name}</p>
                  <p className="text-[12.5px] text-muted">
                    {byId.get(s.botId)?.name} · {describeSchedule(s)}
                    {s.lastRunAt ? <span className="text-faint"> · last ran {ago(s.lastRunAt)}</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="icon-sm" variant="ghost" aria-label="Run now" onClick={() => runNow.mutate(s.id, { onSuccess: () => toast.success("Started") })}><Play /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing({ open: true, schedule: s })}><Pencil /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => remove.mutate(s.id)}><Trash /></Button>
                </div>
                <Switch checked={s.enabled} onCheckedChange={() => toggle.mutate(s, { onError: (e) => toast.error(errorMessage(e)) })} />
              </div>
            ))}
          </div>
        )}
      </div>
      <ScheduleDialog open={editing.open} schedule={editing.schedule} onOpenChange={(open) => setEditing((s) => ({ ...s, open }))} />
    </div>
  )
}
