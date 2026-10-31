import { Brain, Pencil, Plus, Trash } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { BotAvatar } from "@/components/bot-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, Input, Textarea } from "@/components/ui/input"
import { EmptyState, PageHeader } from "@/components/ui/misc"
import { Select } from "@/components/ui/select"
import { api } from "@/lib/api"
import { keys, useAction, useBots, useMemories } from "@/lib/queries"
import type { Memory } from "@/lib/types"
import { ago, cn, errorMessage } from "@/lib/utils"

function MemoryDialog({ memory, open, onOpenChange }: { memory?: Memory; open: boolean; onOpenChange: (v: boolean) => void }) {
  const bots = useBots()
  const [key, setKey] = useState(memory?.key ?? "")
  const [content, setContent] = useState(memory?.content ?? "")
  const [owner, setOwner] = useState(memory?.botId ?? "shared")
  const save = useAction(() => {
    const body = { key, content, botId: owner === "shared" ? null : owner }
    return memory ? api(`/memories/${memory.id}`, { method: "PATCH", body }) : api("/memories", { body })
  }, [keys.memories])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={memory ? "Edit memory" : "Add memory"}
        footer={
          <Button variant="primary" disabled={!key || !content} loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => toast.error(errorMessage(e)) })}>
            Save
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Who knows this">
            <Select
              value={owner}
              onValueChange={setOwner}
              options={[{ value: "shared", label: "Every bot" }, ...(bots.data ?? []).map((b) => ({ value: b.id, label: `Only ${b.name}` }))]}
            />
          </Field>
          <Field label="Name">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="preferred-language" />
          </Field>
          <Field label="What to remember">
            <Textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Writes in British English. Prefers short updates." />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function MemoryRoute() {
  const memories = useMemories()
  const bots = useBots()
  const [filter, setFilter] = useState<string>("all")
  const [editing, setEditing] = useState<{ open: boolean; memory?: Memory }>({ open: false })
  const remove = useAction((id: string) => api(`/memories/${id}`, { method: "DELETE" }), [keys.memories])
  const byId = new Map((bots.data ?? []).map((b) => [b.id, b]))
  const list = (memories.data ?? []).filter((m) => filter === "all" || (filter === "shared" ? !m.botId : m.botId === filter))

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Memory"
        description="What your bots remember between conversations. Shared facts are known to every bot."
        actions={<Button size="sm" onClick={() => setEditing({ open: true })}><Plus /> Add</Button>}
      />
      <div className="mx-auto max-w-3xl px-8 py-5">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {[{ id: "all", label: "All" }, { id: "shared", label: "Shared" }, ...(bots.data ?? []).map((b) => ({ id: b.id, label: b.name }))].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn("rounded-full border px-3 py-1 text-[12.5px]", filter === f.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:bg-hover")}
            >
              {f.label}
            </button>
          ))}
        </div>
        {!list.length ? (
          <EmptyState icon={<Brain />} title="Nothing remembered yet" body="Bots save facts as they learn them, like how you like things done. You can add your own too." />
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-panel">
            {list.map((m) => {
              const bot = m.botId ? byId.get(m.botId) : undefined
              return (
                <div key={m.id} className="group flex items-start gap-3 p-3.5">
                  {bot ? <BotAvatar bot={bot} size="sm" /> : <span className="grid size-6 place-items-center rounded-full bg-raised text-muted"><Brain className="size-3.5" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{m.key}</p>
                    <p className="selectable mt-0.5 text-[13px] text-muted">{m.content}</p>
                    <p className="mt-1 text-[11px] text-faint">{bot ? bot.name : "Every bot"} · {ago(m.updatedAt)}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditing({ open: true, memory: m })} aria-label="Edit"><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(m.id)} aria-label="Delete"><Trash /></Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {editing.open ? <MemoryDialog open memory={editing.memory} onOpenChange={(open) => setEditing({ open })} /> : null}
    </div>
  )
}
