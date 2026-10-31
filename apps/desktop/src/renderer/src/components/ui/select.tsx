import { Check, ChevronDown } from "lucide-react"
import { Select as S } from "radix-ui"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: {
  value: string | undefined
  onValueChange: (v: string) => void
  options: { value: string; label: ReactNode }[]
  placeholder?: string
  className?: string
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 text-[13px] outline-none focus:border-accent data-[placeholder]:text-faint",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown className="size-4 text-faint" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={6} className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-pop">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default items-center rounded-md py-1.5 pl-7 pr-2 text-[13px] outline-none data-[highlighted]:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check className="size-3.5" />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}
