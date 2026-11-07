import { clsx, type ClassValue } from "clsx"
import { differenceInCalendarDays, formatDistanceToNowStrict, isSameDay, isThisYear, isToday, isYesterday, format } from "date-fns"
import { twMerge } from "tailwind-merge"

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

// Sidebar times: the time today, then Yesterday, a weekday within the week, a date after
export function shortTime(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date
  if (Date.now() - d.getTime() < 60_000) return "now"
  if (isToday(d)) return format(d, "h:mm a")
  if (isYesterday(d)) return "Yesterday"
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, "EEE")
  return format(d, "MMM d")
}

// The divider above a message that starts a new stretch of the conversation
export function chatStamp(date: string | Date) {
  const d = typeof date === "string" ? new Date(date) : date
  const time = format(d, "h:mm a")
  if (isToday(d)) return `Today ${time}`
  if (isYesterday(d)) return `Yesterday ${time}`
  if (differenceInCalendarDays(new Date(), d) < 7) return `${format(d, "EEEE")} ${time}`
  return format(d, isThisYear(d) ? "MMM d, h:mm a" : "MMM d, yyyy, h:mm a")
}

// A divider goes on the first message, a new day, or after 15 quiet minutes
export function startsStretch(date: string, prev: string | undefined) {
  if (!prev) return true
  const a = new Date(prev)
  const b = new Date(date)
  return !isSameDay(a, b) || b.getTime() - a.getTime() >= 15 * 60_000
}

export const ago = (date: string | Date) => formatDistanceToNowStrict(typeof date === "string" ? new Date(date) : date, { addSuffix: true })

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong")
