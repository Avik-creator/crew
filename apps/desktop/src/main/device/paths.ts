import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"

export const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p)

// The real path with every symlink followed. A path that doesn't exist yet
// (a file writeFile is about to create) resolves through its nearest
// existing parent, with the missing part added back.
function realPath(p: string): string {
  const missing: string[] = []
  let current = resolve(expandHome(p))
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      const parent = dirname(current)
      if (parent === current) throw err
      missing.push(basename(current))
      current = parent
    }
  }
}

const isInside = (target: string, root: string) =>
  target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)

// Bots may only touch files inside the folders the person picked. Symlinks
// are followed first, so a link inside an allowed folder can't point out of it.
export function assertAllowed(path: string, allowed: string[]) {
  const target = realPath(path)
  const ok = allowed.some((root) => {
    try {
      return isInside(target, realPath(root))
    } catch {
      return false
    }
  })
  if (!ok) {
    throw new Error(
      allowed.length
        ? `${path} is outside the folders you allowed (${allowed.join(", ")}).`
        : "No folders are allowed on this Mac yet. Add one in Crew → Settings → This Mac.",
    )
  }
  return target
}
