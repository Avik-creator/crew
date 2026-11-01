import { useMemo, useState, type ReactNode } from "react"

import { UIContext, type UI } from "@/lib/ui"
import type { Bot, Thread } from "@/lib/types"

import { BotDialog } from "./bot-dialog"
import { CommandPalette } from "./command-palette"
import { GroupDialog } from "./group-dialog"

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
    <UIContext.Provider value={ui}>
      {children}
      <BotDialog open={bot.open} bot={bot.bot} onOpenChange={(open) => setBot((s) => ({ ...s, open }))} />
      <GroupDialog open={group.open} group={group.group} onOpenChange={(open) => setGroup((s) => ({ ...s, open }))} />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </UIContext.Provider>
  )
}
