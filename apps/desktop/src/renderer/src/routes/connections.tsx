import { Check, Plus, RefreshCw, Settings2, TriangleAlert, Unplug } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ConnectorIcon } from "@/components/connector-icon"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Field, Input } from "@/components/ui/input"
import { Badge, PageHeader, Section, Switch } from "@/components/ui/misc"
import { Select } from "@/components/ui/select"
import { api } from "@/lib/api"
import { keys, useAction, useConnectors, useConnectorTools, useDevices } from "@/lib/queries"
import type { Connector, ConnectorTemplate } from "@/lib/types"
import { cn, errorMessage } from "@/lib/utils"

function StatusBadge({ c }: { c: Connector }) {
  if (c.needsSetup) return <Badge tone="warn">Needs setup</Badge>
  const s = c.connection?.status
  if (s === "active") return <Badge tone="ok"><Check className="size-3" /> Connected</Badge>
  if (s === "error") return <Badge tone="danger"><TriangleAlert className="size-3" /> Reconnect</Badge>
  if (s === "pending") return <Badge>Waiting for sign-in</Badge>
  return null
}

function ConnectorCard({ c, onTools, onSecrets }: { c: Connector; onTools: () => void; onSecrets: () => void }) {
  const connect = useAction(() => api<{ authorizeUrl?: string; connected?: true }>(`/connectors/${c.id}/connect`, { method: "POST" }), [keys.connectors])
  const disconnect = useAction(() => api(`/connectors/${c.id}`, { method: "DELETE" }), [keys.connectors, keys.bots])
  const remove = useAction(() => api(`/connectors/custom/${c.id}`, { method: "DELETE" }), [keys.connectors, keys.bots])
  const active = c.connection?.status === "active"
  const needsSecrets = c.authMode === "token" || (c.envKeys?.length ?? 0) > 0

  const start = async () => {
    if (needsSecrets && c.runOn !== "device") return onSecrets()
    try {
      const res = await connect.mutateAsync(undefined)
      if (res.authorizeUrl) {
        await window.crew.openExternal(res.authorizeUrl)
        toast("Finish signing in in your browser", { description: `Crew will update when ${c.name} is connected.` })
      } else toast.success(`${c.name} connected`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <ConnectorIcon icon={c.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-semibold">{c.name}</p>
            <StatusBadge c={c} />
          </div>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{c.description || c.url || [c.command, ...(c.args ?? [])].join(" ")}</p>
          {c.connection?.accountLabel ? <p className="mt-1 text-[11.5px] text-faint">{c.connection.accountLabel}</p> : null}
          {c.connection?.error ? <p className="mt-1 text-[11.5px] text-danger">{c.connection.error}</p> : null}
          {c.needsSetup ? <p className="mt-1 text-[11.5px] text-warn">Add its OAuth app keys to the server's .env to enable it.</p> : null}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4">
        {active ? (
          <>
            <Button size="sm" onClick={onTools}>
              <Settings2 /> {c.connection?.toolCount ?? 0} tools
            </Button>
            <Button size="sm" variant="ghost" onClick={() => disconnect.mutate(undefined)} loading={disconnect.isPending}>
              <Unplug /> Disconnect
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={start} loading={connect.isPending} disabled={c.needsSetup}>
            {c.connection?.status === "error" ? "Reconnect" : "Connect"}
          </Button>
        )}
        {c.isCustom ? (
          <Button size="sm" variant="danger-ghost" className="ml-auto" onClick={() => confirm(`Remove ${c.name}?`) && remove.mutate(undefined)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ToolsDialog({ connector, onClose }: { connector: Connector | null; onClose: () => void }) {
  const tools = useConnectorTools(connector?.id ?? null)
  const setMode = useAction(
    ({ name, mode }: { name: string; mode: "always_allow" | "always_ask" | null }) =>
      api(`/connectors/${connector!.id}/tools/${encodeURIComponent(name)}`, { method: "PUT", body: { mode } }),
    [keys.tools(connector?.id ?? "")],
  )
  const refresh = useAction(() => api(`/connectors/${connector!.id}/refresh`, { method: "POST" }), [keys.tools(connector?.id ?? ""), keys.connectors])
  return (
    <Dialog open={!!connector} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={`${connector?.name ?? ""} tools`}
        description="Reading runs on its own. Anything that changes things asks you first, unless you allow it here."
        className="w-[min(640px,calc(100vw-32px))]"
        footer={
          <Button size="sm" variant="ghost" onClick={() => refresh.mutate(undefined)} loading={refresh.isPending}>
            <RefreshCw /> Refresh list
          </Button>
        }
      >
        <div className="divide-y divide-line">
          {(tools.data ?? []).map((t) => {
            const auto = t.mode === "always_allow" || (t.readOnly && t.mode !== "always_ask")
            return (
              <div key={t.name} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{t.title}</p>
                  <p className="line-clamp-2 text-[12px] text-muted">{t.description}</p>
                </div>
                {t.hard ? (
                  <Badge tone="warn">Always asks</Badge>
                ) : (
                  <label className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
                    Run without asking
                    <Switch checked={auto} onCheckedChange={(v) => setMode.mutate({ name: t.name, mode: v ? "always_allow" : "always_ask" })} />
                  </label>
                )}
              </div>
            )
          })}
          {!tools.data?.length && !tools.isLoading ? <p className="py-6 text-center text-[13px] text-muted">No tools listed yet. Try refreshing.</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SecretsDialog({ connector, onClose }: { connector: Connector | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => setValues({}), [connector])
  const save = useAction(
    () => {
      if (connector!.runOn === "device") {
        return window.crew.device.setMcpEnv(connector!.id, values).then(() => api(`/connectors/${connector!.id}/connect`, { method: "POST" }))
      }
      return api(`/connectors/${connector!.id}/secrets`, {
        body: connector!.authMode === "token" ? { token: values.token } : { env: values },
      })
    },
    [keys.connectors],
  )
  const fields = connector?.authMode === "token" ? ["token"] : (connector?.envKeys ?? [])
  return (
    <Dialog open={!!connector} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={`Connect ${connector?.name ?? ""}`}
        description={connector?.runOn === "device" ? "Saved in this Mac's keychain. Never sent to the server." : "Encrypted on the server. Only used to run this connector."}
        footer={
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose, onError: (e) => toast.error(errorMessage(e)) })}>
            Save and connect
          </Button>
        }
      >
        <div className="space-y-3">
          {fields.map((k) => (
            <Field key={k} label={k === "token" ? "Access token" : k}>
              <Input type="password" value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AddServerDialog({ open, onOpenChange, templates }: { open: boolean; onOpenChange: (v: boolean) => void; templates: ConnectorTemplate[] }) {
  const devices = useDevices()
  const [kind, setKind] = useState<"http" | "stdio">("http")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [authMode, setAuthMode] = useState<"oauth" | "token" | "none">("oauth")
  const [command, setCommand] = useState("")
  const [envKeys, setEnvKeys] = useState("")
  const [runOn, setRunOn] = useState<"cloud_computer" | "device">("cloud_computer")
  const [deviceId, setDeviceId] = useState<string>()
  const [template, setTemplate] = useState<string>()

  useEffect(() => {
    if (!open) return
    setName(""); setUrl(""); setCommand(""); setEnvKeys(""); setTemplate(undefined)
  }, [open])

  const useTemplate = (t: ConnectorTemplate) => {
    setKind("stdio")
    setTemplate(t.slug)
    setName(t.name)
    setCommand([t.command, ...(t.args ?? [])].join(" "))
    setEnvKeys(t.envKeys.join(", "))
    setRunOn(t.runOn ?? "cloud_computer")
  }

  const add = useAction(() => {
    const [cmd, ...args] = command.trim().split(/\s+/)
    return api("/connectors/custom", {
      body:
        kind === "http"
          ? { transport: "http", name, url, authMode }
          : {
              transport: "stdio",
              name,
              command: cmd,
              args,
              envKeys: envKeys.split(",").map((s) => s.trim()).filter(Boolean),
              runOn,
              deviceId: runOn === "device" ? deviceId : undefined,
              template,
            },
    })
  }, [keys.connectors])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add an MCP server"
        description="Any server that speaks the Model Context Protocol."
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={add.isPending}
              disabled={!name || (kind === "http" ? !url : !command)}
              onClick={() => add.mutate(undefined, { onSuccess: () => onOpenChange(false), onError: (e) => toast.error(errorMessage(e)) })}
            >
              Add server
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-raised p-1">
            {(["http", "stdio"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn("rounded-md py-1.5 text-[12.5px] font-medium", kind === k ? "bg-panel shadow-sm" : "text-muted")}>
                {k === "http" ? "Remote (URL)" : "Local command"}
              </button>
            ))}
          </div>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My server" />
          </Field>
          {kind === "http" ? (
            <>
              <Field label="URL">
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
              </Field>
              <Field label="Sign-in">
                <Select
                  value={authMode}
                  onValueChange={(v) => setAuthMode(v as typeof authMode)}
                  options={[
                    { value: "oauth", label: "OAuth (sign in with the service)" },
                    { value: "token", label: "Access token" },
                    { value: "none", label: "None" },
                  ]}
                />
              </Field>
            </>
          ) : (
            <>
              {templates.length ? (
                <div className="flex flex-wrap gap-2">
                  {templates.map((t) => (
                    <button key={t.slug} onClick={() => useTemplate(t)} className={cn("flex items-center gap-2 rounded-lg border py-1 pl-1 pr-3 text-[12.5px]", template === t.slug ? "border-accent bg-accent-soft/60" : "border-line hover:bg-hover")}>
                      <ConnectorIcon icon={t.icon} size="sm" /> {t.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="Command" hint="Runs under supervision and is exposed to bots over MCP.">
                <Input className="font-mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-filesystem ~/workspace" />
              </Field>
              <Field label="Environment variables" hint="Names only, comma separated. You'll enter values when connecting.">
                <Input className="font-mono" value={envKeys} onChange={(e) => setEnvKeys(e.target.value)} placeholder="API_KEY, DATABASE_URL" />
              </Field>
              <Field label="Runs on">
                <Select
                  value={runOn}
                  onValueChange={(v) => setRunOn(v as typeof runOn)}
                  options={[
                    { value: "cloud_computer", label: "Cloud computer" },
                    { value: "device", label: "One of my Macs" },
                  ]}
                />
              </Field>
              {runOn === "device" ? (
                <Select value={deviceId} onValueChange={setDeviceId} placeholder="Pick a Mac" options={(devices.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectionsRoute() {
  const connectors = useConnectors()
  const [tools, setTools] = useState<Connector | null>(null)
  const [secrets, setSecrets] = useState<Connector | null>(null)
  const [adding, setAdding] = useState(false)
  const servers = connectors.data?.servers ?? []
  const builtIn = servers.filter((s) => !s.isCustom)
  const custom = servers.filter((s) => s.isCustom)

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Connections"
        description="Apps your bots can use. Pick which bots get which apps when you edit a bot."
        actions={<Button size="sm" onClick={() => setAdding(true)}><Plus /> Add MCP server</Button>}
      />
      <div className="mx-auto max-w-4xl px-8">
        <Section title="Apps">
          <div className="grid grid-cols-2 gap-3">
            {builtIn.map((c) => (
              <ConnectorCard key={c.id} c={c} onTools={() => setTools(c)} onSecrets={() => setSecrets(c)} />
            ))}
          </div>
        </Section>
        <Section title="Your servers" description="Remote MCP servers and local commands you added.">
          {custom.length ? (
            <div className="grid grid-cols-2 gap-3">
              {custom.map((c) => (
                <ConnectorCard key={c.id} c={c} onTools={() => setTools(c)} onSecrets={() => setSecrets(c)} />
              ))}
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="w-full rounded-xl border border-dashed border-line-strong py-8 text-[13px] text-muted hover:bg-hover">
              Add any MCP server by URL or command
            </button>
          )}
        </Section>
      </div>
      <ToolsDialog connector={tools} onClose={() => setTools(null)} />
      <SecretsDialog connector={secrets} onClose={() => setSecrets(null)} />
      <AddServerDialog open={adding} onOpenChange={setAdding} templates={connectors.data?.templates ?? []} />
    </div>
  )
}
