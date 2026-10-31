import { Inbox } from "lucide-react"
import { Link } from "wouter"

import { ApprovalCard, TakeoverCard } from "@/components/inbox-cards"
import { EmptyState, PageHeader } from "@/components/ui/misc"
import { useApprovals, useTakeovers } from "@/lib/queries"
import { ago } from "@/lib/utils"

export function InboxRoute() {
  const approvals = useApprovals()
  const takeovers = useTakeovers()
  const items = [
    ...(takeovers.data ?? []).map((t) => ({ kind: "takeover" as const, at: t.createdAt, t })),
    ...(approvals.data ?? []).map((a) => ({ kind: "approval" as const, at: a.createdAt, a })),
  ].sort((x, y) => y.at.localeCompare(x.at))

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Inbox" description="Things your bots are waiting on you for." />
      <div className="mx-auto max-w-2xl px-8 py-4">
        {!items.length && !approvals.isLoading ? (
          <EmptyState icon={<Inbox />} title="You're all caught up" body="When a bot needs your OK or your hands on its screen, it shows up here." />
        ) : (
          items.map((item) => (
            <div key={item.kind === "approval" ? item.a.id : item.t.id} className="py-1">
              <div className="flex items-center justify-between text-[11.5px] text-faint">
                <span>{ago(item.at)}</span>
                {(item.kind === "approval" ? item.a.threadId : item.t.threadId) ? (
                  <Link href={`/t/${item.kind === "approval" ? item.a.threadId : item.t.threadId}`} className="hover:text-accent">
                    Open conversation →
                  </Link>
                ) : null}
              </div>
              {item.kind === "approval" ? <ApprovalCard approval={item.a} /> : <TakeoverCard takeover={item.t} />}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
