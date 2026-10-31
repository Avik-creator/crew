import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

import { BotDialog } from "@/components/bot-dialog"
import { CommandPalette } from "@/components/command-palette"
import { GroupDialog } from "@/components/group-dialog"

import type { Bot, Thread } from "./types"

type UI = {
  editBot: (bot?: Bot) => void
  editGroup: (group?: Thread) => void
  openPalette: () => void
}

const Ctx = createContext<UI | null>(null)

// App-wide dialogs, opened from anywhere (sidebar, palette, empty states)
export function UIProvider({ children }: { children: ReactNode }) {
  const [bot, setBot] = useState<{ open: boolean; bot?: Bot }>({ open: false })
  const [group, setGroup] = useState<{ open: boolean; group?: Thread }>({ open: false })
  const [palette, setPalette] = useState(false)
  const ui = useMemo<UI>(
    () => ({
      editBot: (b) => setBot({ open: true, bot: b }),
      editGroup: (g) => setGroup({ open: true, group: g }),
      openPalette: () => setPalette(true),
    }),
    [],
  )
  return (
    <Ctx.Provider value={ui}>
      {children}
      <BotDialog open={bot.open} bot={bot.bot} onOpenChange={(open) => setBot((s) => ({ ...s, open }))} />
      <GroupDialog open={group.open} group={group.group} onOpenChange={(open) => setGroup((s) => ({ ...s, open }))} />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </Ctx.Provider>
  )
}

export function useUI() {
  const ui = useContext(Ctx)
  if (!ui) throw new Error("useUI outside UIProvider")
  return ui
}
