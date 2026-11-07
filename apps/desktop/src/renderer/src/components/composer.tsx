import { Extension } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import HardBreak from "@tiptap/extension-hard-break"
import Mention from "@tiptap/extension-mention"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import { exitSuggestion, SuggestionPluginKey, type SuggestionProps } from "@tiptap/suggestion"
import { ArrowUp, AtSign, Plus, Square, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import type { Bot } from "@/lib/types"
import { cn } from "@/lib/utils"

import { colorOf } from "./bot-avatar"
import { MentionMenu, rankBots, type MentionMenuState } from "./mention-menu"
import { Tip } from "./ui/misc"

type Image = { mediaType: string; base64: string; preview: string }

export type ComposerSend = { text: string; mentionBotIds: string[]; images: { mediaType: string; base64: string }[] }

const MAX_IMAGES = 10

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

// The message box. "@" opens a list of bots; a picked bot becomes a chip that
// sends as "@Name" text plus its id, so routing never guesses from the text.
export function Composer({
  mentionable,
  memberIds,
  placeholder,
  working,
  onSend,
  onStop,
  disabled,
}: {
  // Bots the person can @mention here
  mentionable: Bot[]
  // Bots already in this conversation; others are marked in the list
  memberIds?: string[]
  placeholder: string
  working: boolean
  onSend: (msg: ComposerSend) => Promise<void> | void
  onStop?: () => void
  disabled?: boolean
}) {
  const [images, setImages] = useState<Image[]>([])
  const [menu, setMenu] = useState<MentionMenuState | null>(null)
  const [empty, setEmpty] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const menuId = useId()

  // The editor is created once; these refs let its callbacks see fresh values
  const live = useRef({ mentionable, memberIds, placeholder, menu, send: () => {}, addFiles: (_: File[]) => {} })
  live.current.mentionable = mentionable
  live.current.memberIds = memberIds
  live.current.placeholder = placeholder
  live.current.menu = menu

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: () => live.current.placeholder }),
      Mention.configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `@${node.attrs.label}`,
        renderHTML: ({ node }) => {
          const bot = live.current.mentionable.find((b) => b.id === node.attrs.id)
          return ["span", { class: "mention", "data-id": node.attrs.id, style: `--mention: ${colorOf(bot).hex}` }, `@${node.attrs.label}`]
        },
        suggestion: {
          char: "@",
          items: ({ query }) => rankBots(live.current.mentionable, query, live.current.memberIds),
          render: () => {
            const toState = (p: SuggestionProps<Bot, { id: string; label: string }>, index: number): MentionMenuState => ({
              items: p.items,
              query: p.query,
              index,
              rect: p.clientRect?.() ?? null,
              pick: (bot) => p.command({ id: bot.id, label: bot.name }),
            })
            return {
              onStart: (p) => setMenu(toState(p, 0)),
              onUpdate: (p) => setMenu((m) => toState(p, m && m.query === p.query ? Math.min(m.index, Math.max(p.items.length - 1, 0)) : 0)),
              onExit: () => setMenu(null),
              onKeyDown: ({ event, view }) => {
                const m = live.current.menu
                if (!m) return false
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  if (!m.items.length) return true
                  const d = event.key === "ArrowDown" ? 1 : -1
                  setMenu({ ...m, index: (m.index + d + m.items.length) % m.items.length })
                  return true
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  const bot = m.items[m.index]
                  if (bot) m.pick(bot)
                  return !!bot || event.key === "Tab"
                }
                if (event.key === "Escape") {
                  exitSuggestion(view, SuggestionPluginKey)
                  setMenu(null)
                  return true
                }
                return false
              },
            }
          },
        },
      }),
      // Enter sends, Shift+Enter breaks the line. Runs after the mention list,
      // which takes Enter first while it's open.
      Extension.create({
        name: "sendOnEnter",
        addKeyboardShortcuts: () => ({
          Enter: () => {
            if (live.current.menu) return false
            live.current.send()
            return true
          },
          "Mod-Enter": () => {
            live.current.send()
            return true
          },
        }),
      }),
    ],
    editorProps: {
      attributes: {
        class: "composer-input max-h-[200px] min-h-[22px] overflow-y-auto py-[5px] text-[15px] leading-[22px] outline-none selectable",
        role: "textbox",
        "aria-multiline": "true",
        "aria-autocomplete": "list",
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])]
        if (!files.length) return false
        live.current.addFiles(files)
        return true
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])]
        if (!files.length) return false
        event.preventDefault()
        live.current.addFiles(files)
        return true
      },
    },
    onUpdate: ({ editor }) => setEmpty(editor.isEmpty),
  })

  const addFiles = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES - images.length)
    const read = await Promise.all(list.map(readImage))
    setImages((prev) => [...prev, ...read].slice(0, MAX_IMAGES))
  }

  const send = async () => {
    if (!editor || disabled) return
    const text = editor.getText({ blockSeparator: "\n" }).trim()
    if (!text) return
    const ids = new Set<string>()
    editor.state.doc.descendants((node) => {
      if (node.type.name === "mention" && node.attrs.id) ids.add(String(node.attrs.id))
    })
    const sent = images
    editor.commands.clearContent(true)
    setImages([])
    await onSend({ text, mentionBotIds: [...ids], images: sent.map(({ mediaType, base64 }) => ({ mediaType, base64 })) })
  }

  live.current.send = () => void send()
  live.current.addFiles = (files) => void addFiles(files)

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  // A new conversation focuses the box and refreshes the placeholder
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr.setMeta("placeholder", placeholder))
    editor.commands.focus("end")
  }, [editor, placeholder])

  // Tell assistive tech about the open list
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    dom.setAttribute("aria-label", placeholder)
    dom.setAttribute("aria-expanded", String(!!menu))
    if (menu) {
      dom.setAttribute("aria-controls", menuId)
      if (menu.items.length) dom.setAttribute("aria-activedescendant", `${menuId}-${menu.index}`)
      else dom.removeAttribute("aria-activedescendant")
    } else {
      dom.removeAttribute("aria-controls")
      dom.removeAttribute("aria-activedescendant")
    }
  }, [editor, menu, menuId, placeholder])

  // Types "@" at the caret, with a space first when it would touch a word
  const startMention = () => {
    if (!editor) return
    const { from } = editor.state.selection
    const before = editor.state.doc.textBetween(Math.max(0, from - 1), from, "\n", " ")
    editor.chain().focus().insertContent(before && !/\s/.test(before) ? " @" : "@").run()
  }

  const canSend = !empty && !disabled

  return (
    <div className="pb-5">
      {menu ? <MentionMenu state={menu} memberIds={memberIds} id={menuId} /> : null}
      <div
        className={cn(
          "rounded-[26px] border border-line bg-bg transition-colors focus-within:border-line-strong dark:bg-raised",
          disabled && "opacity-60",
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void addFiles([...e.dataTransfer.files])
        }}
      >
        {images.length ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                <img src={img.preview} alt={`Attached image ${i + 1}`} className="size-14 rounded-xl border border-line object-cover" />
                <button
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-fg text-bg opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Remove image ${i + 1}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2 py-[9px] ps-3 pe-2.5">
          <Tip label="Add images" side="top">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={disabled || images.length >= MAX_IMAGES}
              className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
              aria-label="Add images"
            >
              <Plus className="size-4" strokeWidth={2} />
            </button>
          </Tip>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles([...e.target.files])
              e.target.value = ""
            }}
          />
          <EditorContent editor={editor} className="min-w-0 flex-1 px-0.5" />
          {mentionable.length ? (
            <Tip label="Mention a bot  @" side="top">
              <button
                onClick={startMention}
                disabled={disabled}
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
                aria-label="Mention a bot"
              >
                <AtSign className="size-4" />
              </button>
            </Tip>
          ) : null}
          {/* While a bot works, Stop sits beside Send: a new message still reaches it */}
          {working ? (
            <Tip label="Stop" side="top">
              <button
                onClick={onStop}
                className="grid size-8 shrink-0 place-items-center rounded-full border border-line bg-raised text-fg/80 shadow-sm transition-colors hover:bg-hover"
                aria-label="Stop"
              >
                <Square className="size-[11px] fill-current" />
              </button>
            </Tip>
          ) : null}
          <button
            onClick={() => void send()}
            disabled={!canSend}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-bg transition-[opacity,transform] hover:opacity-85 active:scale-95 disabled:bg-fg/13 disabled:text-fg/30"
            aria-label="Send"
          >
            <ArrowUp className="size-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  )
}
