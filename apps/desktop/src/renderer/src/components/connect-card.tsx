import { Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { keys, queryClient, useConnectors } from "@/lib/queries"
import { errorMessage } from "@/lib/utils"

import { ConnectorIcon } from "./connector-icon"

export type ConnectRequest = { serverId: string; name: string; icon: string; threadId: string; status: "needs_connect" | "connected" }

export const isConnectRequest = (v: unknown): v is ConnectRequest =>
  !!v && typeof v === "object" && typeof (v as ConnectRequest).serverId === "string" && typeof (v as ConnectRequest).threadId === "string"

// A bot asked for an app: connect it here, then let the bot carry on
export function ConnectCard({ request, why, botName }: { request: ConnectRequest; why?: string; botName?: string }) {
  const connectors = useConnectors()
  const [, navigate] = useLocation()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const server = connectors.data?.servers.find((s) => s.id === request.serverId)
  const status = server?.connection?.status
  const connected = status === "active"
  const needsSecrets = !!server && (server.authMode === "token" || (server.envKeys?.length ?? 0) > 0)

  const connect = async () => {
    if (needsSecrets) return navigate("/connections")
    setBusy(true)
    try {
      const res = await api<{ authorizeUrl?: string; connected?: true }>(`/connectors/${request.serverId}/connect`, { method: "POST" })
      if (res.authorizeUrl) {
        await window.crew.openExternal(res.authorizeUrl)
        toast("Finish signing in in your browser", { description: `Crew will update when ${request.name} is connected.` })
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      void queryClient.invalidateQueries({ queryKey: keys.connectors })
    }
  }

  const carryOn = async () => {
    setSent(true)
    try {
      await api(`/threads/${request.threadId}/messages`, { body: { text: `I connected ${request.name}. Go ahead.` } })
    } catch (err) {
      setSent(false)
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="my-1 flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-panel p-3">
      <ConnectorIcon icon={request.icon} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">
          {connected ? `${request.name} is connected` : `${botName ?? "This bot"} wants to use ${request.name}`}
        </p>
        {connected ? null : why ? <p className="line-clamp-2 text-[12px] text-muted">{why}</p> : null}
        {server?.connection?.error && !connected ? <p className="text-[11.5px] text-danger">{server.connection.error}</p> : null}
      </div>
      {connected ? (
        sent ? (
          <span className="flex items-center gap-1 text-[12px] text-muted"><Check className="size-3.5" /> Sent</span>
        ) : (
          <Button size="sm" onClick={() => void carryOn()}>Continue</Button>
        )
      ) : (
        <Button size="sm" variant="primary" loading={busy} disabled={!server} onClick={() => void connect()}>
          {needsSecrets ? "Add key" : status === "pending" ? "Open sign-in again" : status === "error" ? "Reconnect" : "Connect"}
        </Button>
      )}
    </div>
  )
}
