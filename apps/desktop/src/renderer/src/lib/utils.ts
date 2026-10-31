import { clsx, type ClassValue } from "clsx"
import { formatDistanceToNowStrict, isToday, isYesterday, format } from "date-fns"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export function shortTime(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date
  if (Date.now() - d.getTime() < 60_000) return "now"
  if (isToday(d)) return format(d, "h:mm a")
  if (isYesterday(d)) return "Yesterday"
  return format(d, "MMM d")
}

export const ago = (date: string | Date) => formatDistanceToNowStrict(typeof date === "string" ? new Date(date) : date, { addSuffix: true })

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong")
