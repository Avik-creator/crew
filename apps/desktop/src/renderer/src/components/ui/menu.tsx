import { DropdownMenu as M } from "radix-ui"
import type { ComponentProps, ReactNode } from "react"

import { cn } from "@/lib/utils"

export const Menu = M.Root
export const MenuTrigger = M.Trigger

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 min-w-44 rounded-lg border border-line bg-panel p-1 shadow-pop", className)}
      >
        {children}
      </M.Content>
    </M.Portal>
  )
}

export function MenuItem({ className, danger, ...props }: ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-danger [&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  )
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-faint">{children}</M.Label>
)
