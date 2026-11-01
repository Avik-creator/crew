import { X } from "lucide-react"
import { Dialog as D } from "radix-ui"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  title,
  description,
  children,
  className,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
  footer?: ReactNode
}) {
  return (
    <D.Portal>
      {/* no-drag: window-drag strips under the dialog would otherwise eat its clicks */}
      <D.Overlay className="no-drag fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
      <D.Content
        className={cn(
          "no-drag fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-panel shadow-pop outline-none animate-pop-in",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-5">
          <div>
            <D.Title className="text-[15px] font-semibold">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-[12.5px] text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </D.Content>
    </D.Portal>
  )
}
