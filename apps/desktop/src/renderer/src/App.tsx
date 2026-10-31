import { QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast, Toaster } from "sonner"
import { Route, Switch, useLocation } from "wouter"

import { ErrorBoundary } from "@/components/error-boundary"
import { Sidebar } from "@/components/sidebar"
import { TipProvider } from "@/components/ui/misc"
import { Spinner } from "@/components/ui/spinner"
import { api, auth, initApi, onUnauthorized } from "@/lib/api"
import { connectEvents } from "@/lib/events"
import { keys, queryClient, useApprovals, useMe, useTakeovers } from "@/lib/queries"
import { UIProvider } from "@/lib/ui"
import { AuthRoute } from "@/routes/auth"
import { ChatRoute } from "@/routes/chat"
import { ConnectionsRoute } from "@/routes/connections"
import { HomeRoute } from "@/routes/home"
import { InboxRoute } from "@/routes/inbox"
import { MemoryRoute } from "@/routes/memory"
import { SchedulesRoute } from "@/routes/schedules"
import { SettingsRoute } from "@/routes/settings"

function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const [, navigate] = useLocation()
  const approvals = useApprovals()
  const takeovers = useTakeovers()

  useEffect(() => connectEvents(), [])

  // New accounts start in UTC; adopt this computer's time zone once
  const me = useMe()
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (me.data?.settings.timeZone === "UTC" && local && local !== "UTC") {
      void api("/settings", { method: "PATCH", body: { timeZone: local } }).then(() => queryClient.invalidateQueries({ queryKey: keys.me }))
    }
  }, [me.data?.settings.timeZone])

  // crew:// links: connector sign-in finished, or a notification target
  useEffect(() => {
    const offLink = window.crew.onDeepLink((url) => {
      const u = new URL(url)
      if (u.host === "connections") {
        void queryClient.invalidateQueries({ queryKey: keys.connectors })
        if (u.pathname === "/done") toast.success("Connected", { description: "Your bots can use it now." })
        else if (u.searchParams.get("error")) toast.error("Couldn't connect. Try again from Connections.")
        navigate("/connections")
      } else if (u.host === "t") navigate(`/t${u.pathname}`)
    })
    const offNav = window.crew.onNavigate(navigate)
    return () => {
      offLink()
      offNav()
    }
  }, [navigate])

  const waiting = (approvals.data?.length ?? 0) + (takeovers.data?.length ?? 0)
  useEffect(() => void window.crew.setBadge(waiting), [waiting])

  return (
    <div className="flex h-full">
      <Sidebar onSignOut={onSignOut} />
      <main className="min-w-0 flex-1 bg-bg">
        <ErrorBoundary>
        <Switch>
          <Route path="/t/:id">{(p) => <ChatRoute key={p.id} threadId={p.id} />}</Route>
          <Route path="/inbox" component={InboxRoute} />
          <Route path="/connections" component={ConnectionsRoute} />
          <Route path="/schedules" component={SchedulesRoute} />
          <Route path="/memory" component={MemoryRoute} />
          <Route path="/settings">{() => <SettingsRoute onSignOut={onSignOut} />}</Route>
          <Route component={HomeRoute} />
        </Switch>
        </ErrorBoundary>
      </main>
    </div>
  )
}

export function App() {
  useSystemTheme()
  const [state, setState] = useState<"loading" | "signed-out" | "signed-in">("loading")

  useEffect(() => {
    void initApi().then(({ signedIn }) => setState(signedIn ? "signed-in" : "signed-out"))
    return onUnauthorized(() => {
      void auth.signOut().then(() => {
        queryClient.clear()
        setState("signed-out")
      })
    })
  }, [])

  const signOut = async () => {
    await auth.signOut()
    queryClient.clear()
    setState("signed-out")
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        {state === "loading" ? (
          <div className="grid h-full place-items-center">
            <Spinner className="text-faint" />
          </div>
        ) : state === "signed-out" ? (
          <AuthRoute onSignedIn={() => setState("signed-in")} />
        ) : (
          <UIProvider>
            <Shell onSignOut={signOut} />
          </UIProvider>
        )}
        <Toaster position="bottom-right" toastOptions={{ className: "!bg-panel !text-fg !border-line" }} />
      </TipProvider>
    </QueryClientProvider>
  )
}
