import { Button, Key, keyboard, mouse, Point, straightTo } from "@nut-tree-fork/nut-js"

keyboard.config.autoDelayMs = 8
mouse.config.autoDelayMs = 30
mouse.config.mouseSpeed = 2500

const KEYS: Record<string, Key> = {
  cmd: Key.LeftSuper, command: Key.LeftSuper, meta: Key.LeftSuper, super: Key.LeftSuper,
  ctrl: Key.LeftControl, control: Key.LeftControl,
  alt: Key.LeftAlt, option: Key.LeftAlt, opt: Key.LeftAlt,
  shift: Key.LeftShift,
  enter: Key.Enter, return: Key.Enter, tab: Key.Tab, esc: Key.Escape, escape: Key.Escape,
  space: Key.Space, backspace: Key.Backspace, delete: Key.Delete, del: Key.Delete,
  up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
  home: Key.Home, end: Key.End, pageup: Key.PageUp, page_up: Key.PageUp, pagedown: Key.PageDown, page_down: Key.PageDown,
}

function toKey(name: string): Key {
  const k = name.trim().toLowerCase()
  if (KEYS[k] !== undefined) return KEYS[k]!
  if (/^f([1-9]|1[0-2])$/.test(k)) return Key[k.toUpperCase() as keyof typeof Key] as Key
  if (/^[a-z]$/.test(k)) return Key[k.toUpperCase() as keyof typeof Key] as Key
  if (/^[0-9]$/.test(k)) return Key[`Num${k}` as keyof typeof Key] as Key
  throw new Error(`Unknown key "${name}"`)
}

const at = (x: number, y: number, scale: number) => new Point(Math.round(x * scale), Math.round(y * scale))

// Mouse and keyboard through nut.js; needs Accessibility permission on macOS
export const input = {
  async click(x: number, y: number, scale: number, button: "left" | "right" | "middle" = "left", double = false) {
    await mouse.setPosition(at(x, y, scale))
    const b = button === "right" ? Button.RIGHT : button === "middle" ? Button.MIDDLE : Button.LEFT
    if (double) await mouse.doubleClick(b)
    else await mouse.click(b)
  },
  async move(x: number, y: number, scale: number) {
    await mouse.move(straightTo(at(x, y, scale)))
  },
  async drag(fromX: number, fromY: number, toX: number, toY: number, scale: number) {
    await mouse.setPosition(at(fromX, fromY, scale))
    await mouse.drag(straightTo(at(toX, toY, scale)))
  },
  async scroll(x: number, y: number, scale: number, direction: "up" | "down" | "left" | "right", amount = 5) {
    await mouse.setPosition(at(x, y, scale))
    const steps = amount * 3
    if (direction === "up") await mouse.scrollUp(steps)
    else if (direction === "down") await mouse.scrollDown(steps)
    else if (direction === "left") await mouse.scrollLeft(steps)
    else await mouse.scrollRight(steps)
  },
  async type(text: string) {
    await keyboard.type(text)
  },
  async press(combo: string) {
    const keys = combo.split("+").map(toKey)
    await keyboard.pressKey(...keys)
    await keyboard.releaseKey(...keys.reverse())
  },
}
