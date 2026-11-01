import { ArrowUp, ImagePlus, Square, X } from "lucide-react"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"

import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { BotAvatar } from "./bot-avatar"
import { Button } from "./ui/button"
import { Tip } from "./ui/misc"

type Image = { mediaType: string; base64: string; preview: string }

export type ComposerSend = { text: string; mentionBotIds: string[]; images: { mediaType: string; base64: string }[] }

const readImage = (file: File) =>
  new Promise<Image>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({ mediaType: file.type, base64: url.split(",")[1] ?? "", preview: url })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

export function Composer({
  members,
  placeholder,
  working,
  onSend,
  onStop,
  disabled,
}: {
  members: Bot[]
  placeholder: string
  working: boolean
  onSend: (msg: ComposerSend) => Promise<void> | void
  onStop?: () => void
  disabled?: boolean
}) {
  const [text, setText] = useState("")
  const [images, setImages] = useState<Image[]>([])
  const [mention, setMention] = useState<{ query: string; index: number } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    el.style.overflowY = el.scrollHeight > 220 ? "auto" : "hidden"
  }, [text])

  useEffect(() => ref.current?.focus(), [placeholder])

  const matches = mention ? members.filter((m) => m.name.toLowerCase().startsWith(mention.query.toLowerCase())).slice(0, 6) : []

  const updateMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const m = /(^|\s)@(\w*)$/.exec(before)
    setMention(m && members.length > 1 ? { query: m[2] ?? "", index: 0 } : null)
  }

  const pick = (bot: Bot) => {
    const el = ref.current
    const caret = el?.selectionStart ?? text.length
    const before = text.slice(0, caret).replace(/@(\w*)$/, `@${bot.name} `)
    setText(before + text.slice(caret))
    setMention(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }

  const send = async () => {
    const value = text.trim()
    if (!value || disabled) return
    const mentionBotIds = members.filter((m) => new RegExp(`@${m.name}\\b`, "i").test(value)).map((m) => m.id)
    setText("")
    setImages([])
    setMention(null)
    await onSend({ text: value, mentionBotIds, images: images.map(({ mediaType, base64 }) => ({ mediaType, base64 })) })
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        const d = e.key === "ArrowDown" ? 1 : -1
        setMention({ ...mention, index: (mention.index + d + matches.length) % matches.length })
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        pick(matches[mention.index]!)
        return
      }
      if (e.key === "Escape") return setMention(null)
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 10 - images.length)
    const read = await Promise.all(list.map(readImage))
    setImages((prev) => [...prev, ...read])
  }

  return (
    <div className="relative px-4 pb-4 pt-1">
      {mention && matches.length ? (
        <div className="absolute bottom-full left-6 z-10 mb-1 w-64 rounded-lg border border-line bg-panel p-1 shadow-pop">
          {matches.map((m, i) => (
            <button
              key={m.id}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left", i === mention.index && "bg-hover")}
            >
              <BotAvatar bot={m} size="xs" />
              <span className="text-[13px] font-medium">{m.name}</span>
              <span className="truncate text-[11.5px] text-faint">{m.job}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="rounded-[22px] border border-line bg-raised/70 transition-colors focus-within:border-line-strong"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void addFiles(e.dataTransfer.files)
        }}
      >
        {images.length ? (
          <div className="flex gap-2 px-3 pt-3">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                <img src={img.preview} alt="" className="size-14 rounded-lg border border-line object-cover" />
                <button
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 hidden size-5 place-items-center rounded-full bg-fg text-bg group-hover:grid"
                  aria-label="Remove image"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1 px-1.5 py-1.5">
          <Tip label="Add image">
            <button onClick={() => fileRef.current?.click()} className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-hover hover:text-fg" aria-label="Add image">
              <ImagePlus className="size-4" />
            </button>
          </Tip>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value)
              updateMention(e.target.value, e.target.selectionStart)
            }}
            onKeyDown={onKey}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault()
                void addFiles(e.clipboardData.files)
              }
            }}
            className="block max-h-[160px] min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] outline-none placeholder:text-faint"
          />
          {working && !text.trim() ? (
            <Tip label="Stop">
              <Button size="icon-sm" variant="secondary" onClick={onStop} className="rounded-full" aria-label="Stop">
                <Square className="fill-current" />
              </Button>
            </Tip>
          ) : (
            <Button size="icon-sm" variant="primary" onClick={() => void send()} disabled={!text.trim() || disabled} className="rounded-full" aria-label="Send">
              <ArrowUp />
            </Button>
          )}
        </div>
        {members.length > 1 ? <p className="px-12 pb-2 text-[11.5px] text-faint">Type @ to pick who answers</p> : null}
      </div>
    </div>
  )
}
