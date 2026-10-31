import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"

// Server-only helpers. Not exported from the package root so the desktop
// renderer never pulls node:crypto in.

function key() {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) throw new Error("ENCRYPTION_KEY is not set")
  // Accept base64 or hex of 32 bytes, or derive from any passphrase
  const buf = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64").length === 32
      ? Buffer.from(raw, "base64")
      : createHash("sha256").update(raw).digest()
  return buf
}

// AES-256-GCM; output is iv.tag.ciphertext in base64url
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, data].map((b) => b.toString("base64url")).join(".")
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"))
  if (!iv || !tag || !data) throw new Error("Malformed encrypted value")
  const decipher = createDecipheriv("aes-256-gcm", key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
}

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value))
}

export function decryptJson<T>(payload: string | null | undefined): T | undefined {
  if (!payload) return undefined
  return JSON.parse(decrypt(payload)) as T
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url")
}

export function hashToken(token: string) {
  const pepper = process.env.DEVICE_TOKEN_PEPPER ?? ""
  return createHash("sha256").update(pepper + token).digest("hex")
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function truncate(text: string, max = 20_000) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n… truncated ${text.length - max} more characters`
}

// Public URL of the API server (OAuth callbacks, MCP first-party servers)
export function serverUrl() {
  const url = process.env.SERVER_URL || process.env.BETTER_AUTH_URL || "http://localhost:8787"
  return url.replace(/\/$/, "")
}

// Calls from Trigger tasks to the server's /internal routes
export async function internalFetch(path: string, init: RequestInit = {}) {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) throw new Error("INTERNAL_API_SECRET is not set")
  const res = await fetch(`${serverUrl()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, ...init.headers },
  })
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`)
  return res
}
