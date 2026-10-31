import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const field =
  "w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-fg placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:opacity-60"

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-9", className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-20 resize-none py-2 leading-relaxed", className)} {...props} />
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-[12.5px] font-medium text-fg", className)} {...props} />
}

export function Hint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("mt-1.5 text-[12px] text-muted", className)} {...props} />
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint ? <Hint>{hint}</Hint> : null}
    </div>
  )
}
