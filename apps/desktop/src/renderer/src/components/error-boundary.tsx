import { TriangleAlert } from "lucide-react"
import { Component, type ReactNode } from "react"

import { Button } from "./ui/button"

// Keeps one broken view from blanking the whole window
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-md">
          <TriangleAlert className="mx-auto size-6 text-warn" />
          <p className="mt-3 text-[14px] font-semibold">Something broke on this screen</p>
          <p className="selectable mt-1 font-mono text-[12px] text-muted">{this.state.error.message}</p>
          <Button className="mt-4" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
