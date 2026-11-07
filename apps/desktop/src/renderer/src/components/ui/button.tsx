import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

import { Spinner } from "./spinner"

const button = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-fg text-bg hover:bg-fg/85 active:scale-[0.98] motion-reduce:active:scale-100",
        secondary: "bg-hover text-fg hover:bg-fg/12",
        ghost: "text-muted hover:text-fg hover:bg-hover",
        outline: "border border-line-strong text-fg hover:bg-hover",
        danger: "bg-danger text-white hover:brightness-110",
        "danger-ghost": "text-danger hover:bg-danger/10",
      },
      size: {
        sm: "h-7 px-2.5 text-[12.5px]",
        md: "h-8 px-3 text-[13px]",
        lg: "h-10 px-4 text-sm",
        icon: "size-8",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
)

type Props = ComponentProps<"button"> & VariantProps<typeof button> & { asChild?: boolean; loading?: boolean }

export function Button({ className, variant, size, asChild, loading, children, disabled, ...props }: Props) {
  const classes = cn(button({ variant, size }), className)
  // Slot needs exactly one child, so asChild buttons skip the spinner
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button className={classes} disabled={disabled || loading} {...props}>
      {loading ? <Spinner className="size-3.5" /> : null}
      {children}
    </button>
  )
}
