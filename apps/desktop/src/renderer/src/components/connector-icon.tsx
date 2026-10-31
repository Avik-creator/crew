import { Database, Folder, Plug, Terminal } from "lucide-react"

import { cn } from "@/lib/utils"

// Simple branded tiles; no third-party logos are bundled
const BRANDS: Record<string, { bg: string; label: string }> = {
  github: { bg: "#24292f", label: "GH" },
  gitlab: { bg: "#e24329", label: "GL" },
  google: { bg: "#4285f4", label: "G" },
  linear: { bg: "#5e6ad2", label: "L" },
  notion: { bg: "#191919", label: "N" },
  sentry: { bg: "#362d59", label: "S" },
}

export function ConnectorIcon({ icon, size = "md" }: { icon: string; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-6 rounded-md text-[10px] [&_svg]:size-3.5", md: "size-9 rounded-lg text-[12px] [&_svg]:size-4", lg: "size-11 rounded-xl text-[14px] [&_svg]:size-5" }[size]
  const brand = BRANDS[icon]
  if (brand) {
    return (
      <span className={cn("grid shrink-0 place-items-center font-bold text-white", box)} style={{ background: brand.bg }}>
        {brand.label}
      </span>
    )
  }
  const Icon = icon === "folder" || icon === "filesystem" ? Folder : icon === "database" || icon === "postgres" ? Database : icon === "terminal" ? Terminal : Plug
  return (
    <span className={cn("grid shrink-0 place-items-center border border-line bg-raised text-muted", box)}>
      <Icon />
    </span>
  )
}
