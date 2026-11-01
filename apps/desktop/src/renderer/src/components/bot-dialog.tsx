import { Cloud, Laptop } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { api } from "@/lib/api"
import { keys, useAction, useDevices } from "@/lib/queries"
import type { Bot, BotColor } from "@/lib/types"
import { cn, errorMessage } from "@/lib/utils"

import { BOT_COLORS, BotAvatar } from "./bot-avatar"
import { Button } from "./ui/button"
import { Dialog, DialogContent } from "./ui/dialog"
import { Field, Input, Textarea } from "./ui/input"
import { Select } from "./ui/select"

const MODELS = [
  { value: "default", label: "Default (GPT-5.4 nano)" },
  { value: "gpt-5-4-nano", label: "GPT-5.4 nano" },
  { value: "gpt-5-5", label: "GPT-5.5" },
  { value: "gpt-5-mini", label: "GPT-5 mini" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5 · most capable" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 · balanced" },
  { value: "claude-haiku-5-5", label: "Claude Haiku 5.5 · fastest" },
]

const JOBS = ["Research and writing", "Code and pull requests", "Email and calendar", "Design review", "Data and spreadsheets", "QA and testing"]

type Draft = {
  name: string
  job: string
  instructions: string
  color: BotColor
  avatar: string
  model: string
  runsOn: "cloud" | "device"
  deviceId: string | null
}

const empty = (): Draft => ({
  name: "",
  job: "",
  instructions: "",
  color: (Object.keys(BOT_COLORS) as BotColor[])[Math.floor(Math.random() * 8)]!,
  avatar: "",
  model: "default",
  runsOn: "cloud",
  deviceId: null,
})

export function BotDialog({ open, onOpenChange, bot }: { open: boolean; onOpenChange: (v: boolean) => void; bot?: Bot }) {
  const [draft, setDraft] = useState<Draft>(empty)
  const [, navigate] = useLocation()
  const devices = useDevices()

  useEffect(() => {
    if (!open) return
    setDraft(
      bot
        ? {
            name: bot.name,
            job: bot.job,
            instructions: bot.instructions,
            color: bot.color,
            avatar: bot.avatar,
            model: bot.model ?? "default",
            runsOn: bot.runsOn,
            deviceId: bot.deviceId,
          }
        : empty(),
    )
  }, [open, bot])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const save = useAction(
    async (d: Draft) => {
      const body = { ...d, model: d.model === "default" ? null : d.model, deviceId: d.runsOn === "device" ? d.deviceId : null }
      return bot ? api<Bot>(`/bots/${bot.id}`, { method: "PATCH", body }) : api<Bot>("/bots", { body })
    },
    [keys.bots, keys.threads],
  )

  const submit = async () => {
    try {
      const saved = await save.mutateAsync(draft)
      onOpenChange(false)
      if (!bot) {
        toast.success(`${saved.name} joined your crew`)
        if (saved.directThreadId) navigate(`/t/${saved.directThreadId}`)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={bot ? `Edit ${bot.name}` : "New bot"}
        description={bot ? undefined : "A teammate with its own job, its own screen and the apps you give it."}
        className="w-[min(620px,calc(100vw-32px))]"
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!draft.name.trim() || !draft.job.trim()}>
              {bot ? "Save" : "Create bot"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <BotAvatar bot={{ name: draft.name || "?", color: draft.color, avatar: draft.avatar }} size="xl" />
            <div className="min-w-0 flex-1 space-y-3">
              <Field label="Name">
                <Input autoFocus value={draft.name} maxLength={50} placeholder="Ava" onChange={(e) => set("name", e.target.value)} />
              </Field>
              <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(BOT_COLORS) as BotColor[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={draft.color === c}
                    aria-label={c}
                    onClick={() => set("color", c)}
                    className={cn("size-5 rounded-full", draft.color === c && "ring-2 ring-fg ring-offset-2 ring-offset-panel")}
                    style={{ background: BOT_COLORS[c].hex }}
                  />
                ))}
                <Input
                  value={draft.avatar}
                  onChange={(e) => set("avatar", [...e.target.value].slice(-1).join(""))}
                  placeholder="Emoji"
                  aria-label="Emoji"
                  className="ml-1 h-7 w-16 text-center"
                />
              </div>
            </div>
          </div>

          <Field label="Job" hint="This is what the bot is for, and what the others ask it to do.">
            <Input value={draft.job} maxLength={100} placeholder="Research and writing" onChange={(e) => set("job", e.target.value)} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {JOBS.map((j) => (
                <button
                  key={j}
                  type="button"
                  aria-pressed={draft.job === j}
                  onClick={() => set("job", j)}
                  className={cn("rounded-full px-2.5 py-0.5 text-[12px]", draft.job === j ? "bg-fg text-bg" : "bg-raised text-muted hover:text-fg")}
                >
                  {j}
                </button>
              ))}
            </div>
          </Field>

          <Field label="How it works" hint="Optional. Tone, rules, what to always or never do.">
            <Textarea
              value={draft.instructions}
              maxLength={4000}
              rows={4}
              placeholder="Keep answers short. Always open a draft PR, never push to main."
              onChange={(e) => set("instructions", e.target.value)}
            />
          </Field>

          <div>
            <p className="mb-1.5 text-[12.5px] font-medium">Works on</p>
            <div role="radiogroup" aria-label="Works on" className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
              {[
                { value: "cloud" as const, icon: Cloud, title: "Cloud computer" },
                { value: "device" as const, icon: Laptop, title: "This Mac" },
              ].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.runsOn === o.value}
                  onClick={() => set("runsOn", o.value)}
                  className={cn(
                    "flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px]",
                    draft.runsOn === o.value ? "bg-panel font-medium text-fg shadow-sm" : "text-muted hover:text-fg",
                  )}
                >
                  <o.icon className="size-3.5" />
                  {o.title}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] text-faint">
              {draft.runsOn === "cloud" ? "Its own screen on the shared computer." : "Uses this Mac. Commands and file changes ask first."}
            </p>
            {draft.runsOn === "device" ? (
              <div className="mt-2">
                {devices.data?.length ? (
                  <Select
                    value={draft.deviceId ?? undefined}
                    onValueChange={(v) => set("deviceId", v)}
                    placeholder="Pick a Mac"
                    options={devices.data.map((d) => ({ value: d.id, label: `${d.name}${d.online ? "" : " (offline)"}` }))}
                  />
                ) : (
                  <p className="rounded-lg bg-raised px-3 py-2 text-[12.5px] text-muted">Link this Mac first in Settings → This Mac.</p>
                )}
              </div>
            ) : null}
          </div>

          <Field label="Model">
            <Select value={draft.model} onValueChange={(v) => set("model", v)} options={MODELS} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
