import { homedir } from "node:os"
import { isAbsolute, normalize, relative, resolve } from "node:path"

export const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : p)

// Bots may only touch files inside the folders the person picked
export function assertAllowed(path: string, allowed: string[]) {
  const target = normalize(resolve(expandHome(path)))
  const ok = allowed.some((root) => {
    const rel = relative(normalize(resolve(expandHome(root))), target)
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
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
