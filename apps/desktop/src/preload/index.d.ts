import type { CrewBridge } from "./index"

declare global {
  interface Window {
    crew: CrewBridge
  }
}

export {}
