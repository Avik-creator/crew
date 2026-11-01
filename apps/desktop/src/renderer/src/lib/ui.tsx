import { createContext, useContext } from "react"

import type { Bot, Thread } from "./types"

export type UI = {
  editBot: (bot?: Bot) => void
  editGroup: (group?: Thread) => void
  openPalette: () => void
}

export const UIContext = createContext<UI | null>(null)

export function useUI() {
  const ui = useContext(UIContext)
  if (!ui) throw new Error("useUI outside UIProvider")
  return ui
}
