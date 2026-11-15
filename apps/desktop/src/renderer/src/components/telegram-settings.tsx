import { useQuery } from "@tanstack/react-query"
import { Send, Unplug } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/misc"
import { Select } from "@/components/ui/select"
import { api } from "@/lib/api"
import { keys, useAction, useBots } from "@/lib/queries"
import { errorMessage } from "@/lib/utils"

type TelegramBridge = {
  botUsername: string | null
  linkCode: string | null
  chatLabel: string | null
  botId: string | null
  status: "linking" | "active" | "error"
  error: string | null
} | null

const CHIEF = "__chief"

// Talk to your bots from Telegram: paste a bot token from @BotFather, then
// open the bot from here so Telegram sends the link code for you
export function TelegramSettings() {
  const bridge = useQuery({
    queryKey: keys.bridges,
    queryFn: () => api<{ telegram: TelegramBridge }>("/bridges"),
    // While waiting for the link, check every few seconds
    refetchInterval: (q) => (q.state.data?.telegram?.status === "linking" ? 3_000 : false),
  })
  const bots = useBots()
  const [token, setToken] = useState("")
  const save = useAction(() => api<{ botUsername: string | null; linkCode: string }>("/bridges/telegram", { method: "PUT", body: { token } }), [keys.bridges])
  const pick = useAction((botId: string | null) => api("/bridges/telegram", { method: "PATCH", body: { botId } }), [keys.bridges])
  const remove = useAction(() => api("/bridges/telegram", { method: "DELETE" }), [keys.bridges])
  const t = bridge.data?.telegram

  const openLink = (username: string | null, code: string | null) => {
    if (username && code) void window.crew.openExternal(`https://t.me/${username}?start=${code}`)
  }

  if (!t) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <p className="text-[12.5px] text-muted">
          Message your bots from your phone and allow or deny their requests with a tap. In Telegram, message @BotFather, send /newbot, and paste the token it gives you here.
        </p>
        <div className="flex gap-2">
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA..." />
          <Button
            variant="primary"
            disabled={!token.trim()}
            loading={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (r) => {
                  setToken("")
                  openLink(r.botUsername, r.linkCode)
                },
                onError: (e) => toast.error(errorMessage(e)),
              })
            }
          >
            Connect
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium">{t.botUsername ? `@${t.botUsername}` : "Telegram bot"}</p>
        {t.status === "active" ? <Badge tone="ok">Linked{t.chatLabel ? ` to ${t.chatLabel}` : ""}</Badge> : null}
        {t.status === "linking" ? <Badge tone="warn">Waiting for you in Telegram</Badge> : null}
        {t.status === "error" ? <Badge tone="danger">Problem</Badge> : null}
        <Button size="sm" variant="ghost" className="ml-auto" loading={remove.isPending} onClick={() => confirm("Disconnect Telegram?") && remove.mutate(undefined)}>
          <Unplug /> Disconnect
        </Button>
      </div>
      {t.error ? <p className="text-[12px] text-danger">{t.error}</p> : null}
      {t.linkCode ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] text-muted">
            Open the bot and press Start, or send it <span className="font-mono text-fg">/start {t.linkCode}</span>
          </p>
          <Button size="sm" variant="primary" onClick={() => openLink(t.botUsername, t.linkCode)}>
            <Send /> Open in Telegram
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-6">
          <p className="text-[12.5px] text-muted">Who answers when you don't @mention a bot</p>
          <Select
            className="w-48"
            value={t.botId ?? CHIEF}
            onValueChange={(v) => pick.mutate(v === CHIEF ? null : v)}
            options={[
              { value: CHIEF, label: "Main assistant" },
              ...(bots.data ?? []).filter((b) => b.role !== "chief").map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
        </div>
      )}
    </div>
  )
}
