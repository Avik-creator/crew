import { Switch as S, Tooltip as T } from "radix-ui"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Switch({ checked, onCheckedChange, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="relative h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  )
}

export function Tip({ label, children, side = "bottom" }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 rounded-md bg-fg px-2 py-1 text-[11.5px] font-medium text-bg shadow">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

export const TipProvider = T.Provider

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-raised px-1 font-sans text-[11px] text-muted", className)}>
      {children}
    </kbd>
  )
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "warn" | "danger"; className?: string }) {
  const tones = {
    neutral: "bg-raised text-muted border-line",
    accent: "bg-accent-soft text-accent border-transparent",
    ok: "bg-ok/12 text-ok border-transparent",
    warn: "bg-warn/12 text-warn border-transparent",
    danger: "bg-danger/12 text-danger border-transparent",
  }
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium", tones[tone], className)}>
      {children}
    </span>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl border border-line bg-raised text-muted [&_svg]:size-5">{icon}</div>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-1 text-[13px] text-muted">{body}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="drag flex items-end justify-between gap-4 border-b border-line px-8 pb-5 pt-10">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="no-drag flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function Section({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="py-6">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
