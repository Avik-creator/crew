import { Check, Laptop, Plug, Plus, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "wouter"

import { BotAvatar } from "@/components/bot-avatar"
import { Button } from "@/components/ui/button"
import { useBots, useConnectors, useMe, useThreads } from "@/lib/queries"
import { useUI } from "@/lib/ui"
import { cn } from "@/lib/utils"

function Step({ done, title, body, action }: { done: boolean; title: string; body: string; action: React.ReactNode }) {
  return (
    <div className={cn("flex items-center gap-4 rounded-xl border border-line bg-panel p-4", done && "opacity-60")}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border", done ? "border-ok bg-ok text-white" : "border-line-strong text-transparent")}>
        <Check className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{title}</p>
        <p className="text-[12.5px] text-muted">{body}</p>
      </div>
      {done ? null : action}
    </div>
  )
}

export function HomeRoute() {
  const ui = useUI()
  const me = useMe()
  const bots = useBots()
  const threads = useThreads()
  const connectors = useConnectors()
  const [device, setDevice] = useState<{ linked: boolean } | null>(null)
  useEffect(() => void window.crew.device.status().then(setDevice), [])

  const botList = bots.data ?? []
  const hasGroup = (threads.data ?? []).some((t) => t.kind === "group")
  const hasApp = (connectors.data?.servers ?? []).some((s) => s.connection?.status === "active")
  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag h-[52px]" />
      <div className="mx-auto max-w-2xl px-8 pb-16 pt-6">
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">
          {greeting}
          {me.data ? `, ${me.data.user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">Your crew works on its own computer. Give them a job and watch them do it.</p>

        {botList.length ? (
          <div className="mt-8 grid grid-cols-2 gap-3">
            {botList.map((b) => (
              <Link
                key={b.id}
                href={b.directThreadId ? `/t/${b.directThreadId}` : "/"}
                className="group flex items-center gap-3 rounded-xl border border-line bg-panel p-3.5 transition-colors hover:border-line-strong hover:bg-raised/40"
              >
                <BotAvatar bot={b} size="lg" working={(threads.data ?? []).some((t) => t.working.includes(b.id))} />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold">{b.name}</p>
                  <p className="truncate text-[12px] text-muted">{b.job}</p>
                  <p className="mt-0.5 text-[11px] text-faint">{b.runsOn === "cloud" ? "Cloud computer" : "Your Mac"}{b.status === "paused" ? " · paused" : ""}</p>
                </div>
              </Link>
            ))}
            <button
              onClick={() => ui.editBot()}
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-3.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <Plus className="size-4" /> New bot
            </button>
          </div>
        ) : null}

        <h2 className="mb-3 mt-10 text-[13px] font-semibold tracking-[-0.01em]">Get set up</h2>
        <div className="space-y-2">
          <Step
            done={botList.length > 0}
            title="Create your first bot"
            body="Give it a name and a job. It gets its own screen on your cloud computer."
            action={<Button variant="primary" size="sm" onClick={() => ui.editBot()}><Plus /> New bot</Button>}
          />
          <Step
            done={hasApp}
            title="Connect your apps"
            body="GitHub, GitLab, Gmail, Linear, Notion and any MCP server."
            action={<Button size="sm" asChild><Link href="/connections"><Plug /> Connect</Link></Button>}
          />
          <Step
            done={!!device?.linked}
            title="Let bots use this Mac (optional)"
            body="For work that needs your own files or apps. You approve commands."
            action={<Button size="sm" asChild><Link href="/settings"><Laptop /> Set up</Link></Button>}
          />
          <Step
            done={hasGroup}
            title="Put bots in a group"
            body="The right bot answers, and they hand work to each other."
            action={<Button size="sm" onClick={() => ui.editGroup()} disabled={botList.length < 2}><Users /> New group</Button>}
          />
        </div>
      </div>
    </div>
  )
}
