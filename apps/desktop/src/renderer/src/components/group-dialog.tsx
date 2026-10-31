import { Check } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { api } from "@/lib/api"
import { keys, useAction, useBots } from "@/lib/queries"
import type { Thread } from "@/lib/types"
import { cn, errorMessage } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { Button } from "./ui/button"
import { Dialog, DialogContent } from "./ui/dialog"
import { Field, Input, Textarea } from "./ui/input"

export function GroupDialog({ open, onOpenChange, group }: { open: boolean; onOpenChange: (v: boolean) => void; group?: Thread }) {
  const bots = useBots()
  const [, navigate] = useLocation()
  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [botIds, setBotIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    setName(group?.name ?? "")
    setGoal(group?.goal ?? "")
    setBotIds(group?.botIds ?? [])
  }, [open, group])

  const save = useAction(
    () =>
      group
        ? api<Thread>(`/threads/${group.id}`, { method: "PATCH", body: { name, goal, botIds } })
        : api<Thread>("/threads/groups", { body: { name, goal, botIds } }),
    [keys.threads],
  )

  const submit = async () => {
    try {
      const t = await save.mutateAsync(undefined)
      onOpenChange(false)
      if (!group) navigate(`/t/${t.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const active = (bots.data ?? []).filter((b) => b.status !== "hidden")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={group ? "Edit group" : "New group"}
        description={group ? undefined : "Put bots in one room. The right one answers, and they pass work between them."}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!name.trim() || botIds.length < 2}>
              {group ? "Save" : "Create group"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input autoFocus value={name} maxLength={50} placeholder="Launch week" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Goal" hint="Optional. Every bot in the group sees it.">
            <Textarea rows={2} value={goal} maxLength={500} placeholder="Ship the v1 landing page by Friday" onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium">Members · {botIds.length} picked</p>
            {active.length < 2 ? (
              <p className="text-[12.5px] text-muted">You need at least two bots for a group.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {active.map((b) => {
                  const on = botIds.includes(b.id)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBotIds(on ? botIds.filter((x) => x !== b.id) : botIds.length >= 6 ? botIds : [...botIds, b.id])}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border p-2 text-left transition-colors",
                        on ? "border-accent bg-accent-soft/60" : "border-line hover:bg-hover",
                      )}
                    >
                      <BotAvatar bot={b} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{b.name}</span>
                        <span className="block truncate text-[11.5px] text-muted">{b.job}</span>
                      </span>
                      {on ? <Check className="size-4 text-accent" /> : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
