import { useCallback, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const read = (key: string, fallback: number) => {
  try {
    const n = Number(localStorage.getItem(key))
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

// A column width the person can drag, kept between launches. The chat keeps
// at least `room` pixels, so a wide column gives way on a small window.
export function useColumnWidth(key: string, initial: number, min: number, max: number, room = 360) {
  const [width, setWidth] = useState(() => read(key, initial))
  const [viewport, setViewport] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const clamp = useCallback((n: number) => Math.round(Math.min(Math.max(n, min), Math.max(min, Math.min(max, viewport - room)))), [min, max, viewport, room])
  const set = useCallback(
    (n: number) => {
      const next = clamp(n)
      setWidth(next)
      try {
        localStorage.setItem(key, String(next))
      } catch {
        // private storage: the width just isn't remembered
      }
    },
    [clamp, key],
  )
  return { width: clamp(width), setWidth: set }
}

// The draggable edge of a column. side is where the column's free edge is:
// "end" for a left sidebar, "start" for a right panel. Arrow keys move it too.
export function ResizeHandle({ side, width, onWidth, label }: { side: "start" | "end"; width: number; onWidth: (n: number) => void; label: string }) {
  const dir = side === "end" ? 1 : -1
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        const startX = e.clientX
        const start = width
        const move = (ev: PointerEvent) => onWidth(start + (ev.clientX - startX) * dir)
        const up = () => {
          window.removeEventListener("pointermove", move)
          window.removeEventListener("pointerup", up)
          document.body.style.cursor = ""
        }
        document.body.style.cursor = "col-resize"
        window.addEventListener("pointermove", move)
        window.addEventListener("pointerup", up)
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onWidth(width - 32 * dir)
        else if (e.key === "ArrowRight") onWidth(width + 32 * dir)
      }}
      className={cn(
        "no-drag absolute inset-y-0 z-30 w-2 cursor-col-resize transition-colors hover:bg-line focus-visible:bg-line",
        side === "end" ? "-right-1" : "-left-1",
      )}
    />
  )
}
