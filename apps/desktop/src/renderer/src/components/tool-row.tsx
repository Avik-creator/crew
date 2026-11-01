import {
  AppWindow,
  AtSign,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  Globe,
  Hand,
  KeyRound,
  Keyboard,
  MousePointerClick,
  Plug,
  ScanSearch,
  Terminal,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { useState, type ReactNode } from "react"

import { MCP_TOOL_SEPARATOR } from "@crew/shared"
import { cn } from "@/lib/utils"

import { Spinner } from "./ui/spinner"

export type ToolPart = {
  type: string
  toolName?: string
  toolCallId: string
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | "output-denied" | "approval-requested" | "approval-responded"
  input?: Record<string, any>
  output?: unknown
  errorText?: string
  approval?: { id: string; approved?: boolean; reason?: string }
}

export const toolNameOf = (p: { type: string; toolName?: string }) =>
  p.type === "dynamic-tool" ? (p.toolName ?? "tool") : p.type.replace(/^tool-/, "")

const humanize = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
const clip = (s: unknown, n = 60) => {
  const t = String(s ?? "")
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// One-line description of what a tool call did, in plain words
export function describeTool(name: string, input: Record<string, any> = {}): { icon: ReactNode; text: ReactNode } {
  switch (name) {
    case "viewScreen":
      return { icon: <Eye />, text: "Looked at the screen" }
    case "mouseClick":
      return { icon: <MousePointerClick />, text: `${input.double ? "Double-clicked" : input.button === "right" ? "Right-clicked" : "Clicked"} at ${input.x}, ${input.y}` }
    case "mouseMove":
      return { icon: <MousePointerClick />, text: `Moved the mouse to ${input.x}, ${input.y}` }
    case "mouseDrag":
      return { icon: <MousePointerClick />, text: "Dragged on the screen" }
    case "mouseScroll":
      return { icon: <MousePointerClick />, text: `Scrolled ${input.direction ?? ""}` }
    case "keyboardType":
      return { icon: <Keyboard />, text: <>Typed <span className="text-fg">“{clip(input.text, 48)}”</span></> }
    case "keyboardPress":
      return { icon: <Keyboard />, text: <>Pressed <span className="font-mono text-fg">{input.keys}</span></> }
    case "bash":
      return { icon: <Terminal />, text: <>Ran <span className="font-mono text-fg">{clip(input.command, 70)}</span></> }
    case "readFile":
      return { icon: <FileText />, text: <>Read <span className="font-mono text-fg">{clip(input.path)}</span></> }
    case "writeFile":
      return { icon: <FileText />, text: <>Wrote <span className="font-mono text-fg">{clip(input.path)}</span></> }
    case "listFiles":
      return { icon: <Folder />, text: <>Looked in <span className="font-mono text-fg">{clip(input.path)}</span></> }
    case "openUrl":
      return { icon: <Globe />, text: <>Opened <span className="text-fg">{clip(input.url)}</span></> }
    case "openApp":
      return { icon: <Globe />, text: `Opened ${input.name}` }
    case "listTeam":
      return { icon: <Users />, text: "Looked over the team" }
    case "createBot":
      return { icon: <UserPlus />, text: <>Created <span className="text-fg">{input.name}</span></> }
    case "updateBot":
      return { icon: <Users />, text: <>Updated <span className="text-fg">{input.name}</span></> }
    case "createGroup":
      return { icon: <Users />, text: <>Made the group <span className="text-fg">{input.name}</span></> }
    case "createSchedule":
      return { icon: <CalendarClock />, text: <>Scheduled <span className="text-fg">{input.name}</span> for {input.bot}</> }
    case "listApps":
      return { icon: <AppWindow />, text: "Checked which apps are open" }
    case "readApp":
      return { icon: <ScanSearch />, text: <>Read <span className="text-fg">{input.app ?? "an app"}</span>{input.surface ? ` (${input.surface})` : ""}</> }
    case "useApp": {
      const verb: Record<string, string> = {
        click: "Clicked", "right-click": "Right-clicked", type: "Typed in", "set-value": "Filled in", select: "Picked", scroll: "Scrolled",
        check: "Checked", uncheck: "Unchecked", toggle: "Toggled", expand: "Expanded", collapse: "Collapsed", focus: "Focused",
        clear: "Cleared", "scroll-to": "Scrolled to", press: "Pressed",
      }
      const detail = input.action === "press" ? input.keys : input.action === "select" ? input.option : input.text
      return {
        icon: <MousePointerClick />,
        text: <>{verb[input.action] ?? humanize(String(input.action ?? "Used"))} {detail ? <span className="text-fg">“{clip(detail, 40)}”</span> : <span className="font-mono text-faint">{clip(input.ref, 24)}</span>}</>,
      }
    }
    case "saveLogins":
      return { icon: <KeyRound />, text: "Saved browser logins for the team" }
    case "remember":
      return { icon: <Brain />, text: `Remembered “${clip(input.key, 40)}”` }
    case "forget":
      return { icon: <Brain />, text: `Forgot “${clip(input.key, 40)}”` }
    case "messageBot":
      return { icon: <AtSign />, text: <>Messaged <span className="text-fg">{input.to}</span></> }
    case "handoff":
      return { icon: <Users />, text: <>Handed off to <span className="text-fg">{input.to}</span></> }
    case "requestTakeover":
      return { icon: <Hand />, text: "Asked you to take over" }
    default: {
      const [server, ...rest] = name.split(MCP_TOOL_SEPARATOR)
      const tool = rest.join(MCP_TOOL_SEPARATOR)
      return { icon: <Plug />, text: tool ? <><span className="text-fg">{humanize(server ?? "")}</span> · {humanize(tool)}</> : humanize(name) }
    }
  }
}

function outputText(output: unknown): string {
  if (output == null) return ""
  if (typeof output === "string") return output
  const o = output as { content?: { type: string; text?: string }[]; stdout?: string; stderr?: string; screenshot?: string }
  if (o.screenshot) return "(screenshot)"
  if (Array.isArray(o.content)) return o.content.map((c) => c.text ?? `[${c.type}]`).join("\n")
  if (typeof o.stdout === "string") return [o.stdout, o.stderr].filter(Boolean).join("\n")
  return JSON.stringify(output, null, 2)
}

export function ToolRow({ part, children }: { part: ToolPart; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const name = toolNameOf(part)
  const { icon, text } = describeTool(name, part.input)
  const running = part.state === "input-streaming" || part.state === "input-available" || part.state === "approval-responded"
  const failed = part.state === "output-error"
  const denied = part.state === "output-denied" || (part.state === "approval-responded" && part.approval?.approved === false)
  const out = part.state === "output-available" ? outputText(part.output) : failed ? (part.errorText ?? "") : ""
  const expandable = !!out || (part.input && Object.keys(part.input).length > 0)

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => expandable && setOpen(!open)}
        className={cn(
          "group flex max-w-full items-center gap-2 rounded-md py-0.5 pr-2 text-left text-[12.5px] text-muted [&>svg]:size-3.5 [&>svg]:shrink-0",
          expandable && "hover:text-fg",
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-raised text-muted [&_svg]:size-3">{icon}</span>
        <span className={cn("truncate", denied && "line-through opacity-70")}>{text}</span>
        {running && part.state !== "approval-requested" ? <Spinner className="size-3 text-faint" /> : null}
        {part.state === "output-available" ? <Check className="text-ok/80" /> : null}
        {failed || denied ? <X className="text-danger/80" /> : null}
        {expandable ? <ChevronRight className={cn("text-faint opacity-0 transition group-hover:opacity-100", open && "rotate-90 opacity-100")} /> : null}
      </button>
      {open ? (
        <div className="selectable ml-7 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-raised/60 p-2.5 font-mono text-[11.5px] leading-relaxed text-muted">
          {part.input && Object.keys(part.input).length ? <pre className="whitespace-pre-wrap break-all">{JSON.stringify(part.input, null, 2)}</pre> : null}
          {out ? <pre className={cn("mt-2 whitespace-pre-wrap break-all border-t border-line pt-2", failed && "text-danger")}>{out.slice(0, 8000)}</pre> : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}
