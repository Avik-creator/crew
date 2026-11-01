import { Cloud, FolderPlus, Laptop, Pause, RotateCcw, Trash, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge, PageHeader, Section, Switch } from "@/components/ui/misc"
import { Select } from "@/components/ui/select"
import { api, auth, serverBase } from "@/lib/api"
import { keys, useAction, useMe, useRules } from "@/lib/queries"
import type { Me } from "@/lib/types"
import { ago, errorMessage } from "@/lib/utils"

type DeviceState = Awaited<ReturnType<typeof window.crew.device.status>>

function Row({ title, body, children }: { title: string; body?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{title}</p>
        {body ? <p className="text-[12.5px] text-muted">{body}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

const COMPUTER_STATUS: Record<Me["computer"]["status"], { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  running: { label: "Running", tone: "ok" },
  paused: { label: "Sleeping", tone: "neutral" },
  creating: { label: "Starting", tone: "warn" },
  error: { label: "Problem", tone: "danger" },
  none: { label: "Not started", tone: "neutral" },
}

function ThisMac() {
  const [state, setState] = useState<DeviceState | null>(null)
  const [busy, setBusy] = useState(false)
  const [pattern, setPattern] = useState("")
  const rules = useRules(state?.deviceId ?? null)
  const refresh = () => void window.crew.device.status().then(setState)
  useEffect(() => {
    refresh()
    const off = window.crew.device.onStatus(() => refresh())
    const t = setInterval(refresh, 5000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  const addRule = useAction(
    (body: { pattern: string; mode: "always_allow" | "deny" }) => api(`/devices/${state!.deviceId}/rules`, { body }),
    [keys.rules(state?.deviceId ?? "")],
  )
  const removeRule = useAction((id: string) => api(`/devices/${state!.deviceId}/rules/${id}`, { method: "DELETE" }), [keys.rules(state?.deviceId ?? "")])

  if (!state) return null
  if (!state.linked) {
    return (
      <div className="flex items-center gap-4 rounded-xl border border-line bg-panel p-4">
        <Laptop className="size-5 text-muted" />
        <div className="flex-1">
          <p className="text-[13px] font-medium">Let bots use this Mac</p>
          <p className="text-[12.5px] text-muted">Bots set to “Your Mac” run commands and use apps here. Commands and file changes ask you first.</p>
        </div>
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await window.crew.device.link(navigator.platform.includes("Mac") ? "My Mac" : "My computer")
              refresh()
              toast.success("This Mac is linked")
            } catch (err) {
              toast.error(errorMessage(err))
            } finally {
              setBusy(false)
            }
          }}
        >
          Link this Mac
        </Button>
      </div>
    )
  }
  const folders = state.allowedPaths
  const setFolders = async (next: string[]) => {
    await window.crew.device.setAllowedPaths(next)
    refresh()
  }
  return (
    <div className="divide-y divide-line rounded-xl border border-line bg-panel px-4">
      <Row title={state.name ?? "This Mac"} body={state.error ?? (state.online ? "Connected. Bots can use it." : "Offline. Reconnecting…")}>
        <Badge tone={state.online ? "ok" : "neutral"}>{state.online ? "Online" : "Offline"}</Badge>
        <Button size="sm" variant="ghost" onClick={() => window.crew.device.unlink().then(refresh)}>
          Unlink
        </Button>
      </Row>
      <Row title="Screen Recording" body="Needed to show bots your screen.">
        {state.capabilities.screen ? <Badge tone="ok">Allowed</Badge> : <Button size="sm" onClick={() => window.crew.device.openPrivacy("screen")}>Allow</Button>}
      </Row>
      <Row title="Accessibility" body="Needed for bots to use the mouse and keyboard.">
        {state.capabilities.input ? <Badge tone="ok">Allowed</Badge> : <Button size="sm" onClick={() => window.crew.device.openPrivacy("accessibility")}>Allow</Button>}
      </Row>
      <Row
        title="App control"
        body={
          state.capabilities.apps
            ? "agent-desktop is installed. Bots read apps' buttons and fields directly instead of clicking on pixels."
            : "Optional. Install agent-desktop so bots use apps through their buttons and fields, without moving your mouse."
        }
      >
        {state.capabilities.apps ? (
          <Badge tone="ok">Installed</Badge>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText("npm i -g agent-desktop")
                toast.success("Copied", { description: "Run it in Terminal, then come back here." })
              }}
            >
              Copy install command
            </Button>
            <Button size="sm" onClick={refresh}>
              Check again
            </Button>
          </>
        )}
      </Row>
      <div className="py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">Folders bots can read and write</p>
            <p className="text-[12.5px] text-muted">Everything else on this Mac is off limits to file tools.</p>
          </div>
          <Button
            size="sm"
            onClick={async () => {
              const dir = await window.crew.device.pickFolder()
              if (dir && !folders.includes(dir)) await setFolders([...folders, dir])
            }}
          >
            <FolderPlus /> Add folder
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {folders.map((f) => (
            <div key={f} className="flex items-center justify-between rounded-lg bg-raised px-3 py-1.5 font-mono text-[12px]">
              {f}
              <button onClick={() => setFolders(folders.filter((x) => x !== f))} className="text-faint hover:text-danger" aria-label="Remove">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="py-3">
        <p className="text-[13px] font-medium">Command rules</p>
        <p className="text-[12.5px] text-muted">Commands run only after you approve, unless they match an allow rule. End with * to match a prefix.</p>
        <div className="mt-2 flex gap-2">
          <Input className="h-8 font-mono" placeholder="git status*" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <Button size="sm" disabled={!pattern} onClick={() => addRule.mutate({ pattern, mode: "always_allow" }, { onSuccess: () => setPattern("") })}>Allow</Button>
          <Button size="sm" variant="ghost" disabled={!pattern} onClick={() => addRule.mutate({ pattern, mode: "deny" }, { onSuccess: () => setPattern("") })}>Block</Button>
        </div>
        <div className="mt-2 space-y-1">
          {(rules.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[12px]">
              <Badge tone={r.mode === "deny" ? "danger" : "ok"}>{r.mode === "deny" ? "Blocked" : "Allowed"}</Badge>
              <span className="flex-1 font-mono">{r.pattern}</span>
              <button onClick={() => removeRule.mutate(r.id)} className="text-faint hover:text-danger" aria-label="Remove">
                <Trash className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <Row title="Kill switch" body="Stops every bot using this Mac, from anywhere.">
        <kbd className="rounded-md border border-line bg-raised px-2 py-0.5 text-[12px]">⌘ ⇧ Esc</kbd>
      </Row>
    </div>
  )
}

export function SettingsRoute({ onSignOut }: { onSignOut: () => void }) {
  const me = useMe()
  const [version, setVersion] = useState("")
  const [update, setUpdate] = useState<{ state: string; version?: string; percent?: number; message?: string }>({ state: "idle" })
  const [server, setServer] = useState(serverBase())
  useEffect(() => {
    void window.crew.config().then((c) => setVersion(c.version))
    return window.crew.update.onState(setUpdate)
  }, [])
  const saveSettings = useAction((body: Partial<Me["settings"]>) => api("/settings", { method: "PATCH", body }), [keys.me])
  const pause = useAction(() => api("/computer/pause", { method: "POST" }), [keys.me])
  const reset = useAction(() => api("/computer/reset", { method: "POST" }), [keys.me])
  const s = me.data?.settings
  const computer = me.data?.computer
  const zones = [...new Set(["UTC", ...(s?.timeZone ? [s.timeZone] : []), ...Intl.supportedValuesOf("timeZone")])]

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="mx-auto max-w-2xl px-8 pb-16">
        <Section title="Cloud computer" description="One computer shared by your bots. Each bot gets its own screen; files and logins are shared.">
          <div className="divide-y divide-line rounded-xl border border-line bg-panel px-4">
            <Row title="Status" body={computer?.lastActiveAt ? `Last used ${ago(computer.lastActiveAt)}. Sleeps after 10 idle minutes.` : "Starts the first time a bot needs a screen."}>
              <Cloud className="size-4 text-muted" />
              {computer ? <Badge tone={COMPUTER_STATUS[computer.status].tone}>{COMPUTER_STATUS[computer.status].label}</Badge> : null}
            </Row>
            <Row title="Put it to sleep" body="Saves everything. It wakes in about a second when needed.">
              <Button size="sm" onClick={() => pause.mutate(undefined)} loading={pause.isPending} disabled={computer?.status !== "running"}>
                <Pause /> Sleep now
              </Button>
            </Row>
            <Row title="Start fresh" body="Deletes the computer with its files and logins. A new one starts next time.">
              <Button
                size="sm"
                variant="danger-ghost"
                loading={reset.isPending}
                onClick={() => confirm("Delete the cloud computer and everything on it?") && reset.mutate(undefined)}
              >
                <RotateCcw /> Reset
              </Button>
            </Row>
          </div>
        </Section>

        <Section title="This Mac">
          <ThisMac />
        </Section>

        <Section title="Notifications">
          <div className="divide-y divide-line rounded-xl border border-line bg-panel px-4">
            {(
              [
                ["replies", "Replies", "When a bot finishes something you didn't wait for."],
                ["approvals", "Approvals and takeovers", "When a bot needs your OK or your hands."],
                ["botMessages", "Bot-to-bot messages", "When bots message each other."],
              ] as const
            ).map(([k, title, body]) => (
              <Row key={k} title={title} body={body}>
                <Switch
                  checked={s?.notifications[k] ?? true}
                  onCheckedChange={(v) => s && saveSettings.mutate({ notifications: { ...s.notifications, [k]: v } })}
                />
              </Row>
            ))}
            <Row title="Time zone" body="Used for schedules and for what “today” means to bots.">
              <Select
                className="w-56"
                value={s?.timeZone}
                onValueChange={(timeZone) => saveSettings.mutate({ timeZone })}
                options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
              />
            </Row>
          </div>
        </Section>

        <Section title="Account">
          <div className="divide-y divide-line rounded-xl border border-line bg-panel px-4">
            <Row title={me.data?.user.name ?? ""} body={me.data?.user.email}>
              <Button size="sm" variant="ghost" onClick={onSignOut}>Sign out</Button>
            </Row>
            <Row title="Server" body="Where your Crew runs.">
              <Input className="h-8 w-64" value={server} onChange={(e) => setServer(e.target.value)} />
              <Button
                size="sm"
                disabled={server === serverBase()}
                onClick={async () => {
                  await auth.setServer(server)
                  toast("Server changed. Sign in again.")
                  onSignOut()
                }}
              >
                Save
              </Button>
            </Row>
            <Row
              title={`Crew ${version}`}
              body={
                update.state === "ready"
                  ? `Version ${update.version} is ready.`
                  : update.state === "downloading"
                    ? `Downloading update… ${update.percent ?? 0}%`
                    : update.state === "error"
                      ? update.message
                      : "Updates install automatically."
              }
            >
              {update.state === "ready" ? (
                <Button size="sm" variant="primary" onClick={() => window.crew.update.install()}>Restart to update</Button>
              ) : (
                <Button size="sm" onClick={() => window.crew.update.check()} loading={update.state === "checking"}>Check for updates</Button>
              )}
            </Row>
          </div>
        </Section>
      </div>
    </div>
  )
}
