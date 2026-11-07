import { Hand, Lock, MonitorPlay, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { keys, useAction } from "@/lib/queries"
import type { Approval, Takeover } from "@/lib/types"
import { errorMessage } from "@/lib/utils"

import { Button } from "./ui/button"
import { Input } from "./ui/input"

function InputPreview({ input }: { input: Record<string, unknown> }) {
  const entries = Object.entries(input).slice(0, 8)
  if (!entries.length) return null
  return (
    <dl className="selectable mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-raised/70 p-2.5 text-[12px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="min-w-0 truncate font-mono text-fg" title={typeof v === "string" ? v : JSON.stringify(v)}>
            {typeof v === "string" ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// Asks the person to OK one tool call. Deciding continues the bot's turn.
export function ApprovalCard({ approval, compact }: { approval: Approval; compact?: boolean }) {
  const decide = useAction(
    (body: { approved: boolean; remember?: boolean }) => api(`/inbox/approvals/${approval.id}`, { body }),
    [keys.approvals],
  )
  const run = (approved: boolean, remember = false) =>
    decide.mutate({ approved, remember }, { onError: (err) => toast.error(errorMessage(err)) })

  return (
    <div className="my-2 max-w-xl rounded-xl border border-warn/40 bg-warn/[0.06] p-3">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px]">
            {compact ? null : <span className="font-medium">{approval.botName} </span>}
            {compact ? "Wants to" : "wants to"} <span className="font-medium">{approval.title}</span>
          </p>
          <InputPreview input={approval.input} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => run(true)} loading={decide.isPending && decide.variables?.approved && !decide.variables.remember}>
              Approve
            </Button>
            {!approval.hard ? (
              <Button size="sm" variant="secondary" onClick={() => run(true, true)} disabled={decide.isPending}>
                Always allow
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => run(false)} disabled={decide.isPending}>
              Deny
            </Button>
            {approval.hard ? (
              <span className="ml-auto flex items-center gap-1 text-[11.5px] text-faint">
                <Lock className="size-3" /> Always asks
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function TakeoverCard({ takeover, onOpenScreen }: { takeover: Takeover; onOpenScreen?: () => void }) {
  const [note, setNote] = useState("")
  const finish = useAction(
    (status: "completed" | "skipped") => api(`/inbox/takeovers/${takeover.id}`, { body: { status, note: note || undefined } }),
    [keys.takeovers],
  )
  const run = (status: "completed" | "skipped") => finish.mutate(status, { onError: (err) => toast.error(errorMessage(err)) })
  return (
    <div className="my-2 max-w-xl rounded-xl border border-accent/40 bg-accent-soft/50 p-3">
      <div className="flex items-start gap-2.5">
        <Hand className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{takeover.botName} needs you</p>
          <p className="mt-0.5 text-[13px] text-muted">{takeover.reason}</p>
          <p className="selectable mt-2 rounded-lg bg-panel/70 px-2.5 py-2 text-[12.5px]">{takeover.instruction}</p>
          <Input className="mt-2 h-8" placeholder="Note for the bot (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {onOpenScreen ? (
              <Button size="sm" variant="secondary" onClick={onOpenScreen}>
                <MonitorPlay /> Open screen
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => run("completed")} loading={finish.isPending && finish.variables === "completed"}>
              I'm done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => run("skipped")} disabled={finish.isPending}>
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
