import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/input"
import { auth, serverBase } from "@/lib/api"
import { cn, errorMessage } from "@/lib/utils"

export function AuthRoute({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"in" | "up">("in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [server, setServer] = useState(serverBase())
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (server !== serverBase()) await auth.setServer(server || null)
      if (mode === "in") await auth.signIn(email, password)
      else await auth.signUp(name, email, password)
      onSignedIn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drag grid h-full place-items-center bg-bg">
      <form onSubmit={submit} className="no-drag relative w-[320px]">
        <div className="mb-7 text-center">
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Crew</h1>
          <p className="mt-1 text-[13px] text-muted">{mode === "in" ? "Sign in to your crew." : "Create an account."}</p>
        </div>
        <div className="space-y-3">
          {mode === "up" ? (
            <Field label="Your name">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" required />
            </Field>
          ) : null}
          <Field label="Email">
            <Input autoFocus={mode === "in"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required />
          </Field>
          {error ? <p className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === "in" ? "Sign in" : "Create account"}
          </Button>
        </div>
        <p className="mt-4 text-center text-[12.5px] text-muted">
          {mode === "in" ? "New here? " : "Already have an account? "}
          <button type="button" className="font-medium text-accent hover:underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
        <div className="mt-6 text-center">
          <button type="button" onClick={() => setAdvanced(!advanced)} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-muted">
            Server <ChevronRight className={cn("size-3 transition-transform", advanced && "rotate-90")} />
          </button>
          {advanced ? <Input className="mt-2 text-center" value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://localhost:8787" /> : null}
        </div>
      </form>
    </div>
  )
}
