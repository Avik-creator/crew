import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { app, safeStorage } from "electron"

export type StoreData = {
  serverUrl?: string
  sessionToken?: string
  device?: { id: string; token: string; name: string }
  allowedPaths?: string[]
  // Environment values for local-command connectors, by server id
  mcpEnv?: Record<string, Record<string, string>>
}

// Small settings file encrypted with the OS keychain (safeStorage). Tokens
// never reach the renderer except the session token it needs for API calls.
class SecureStore {
  private file = join(app.getPath("userData"), "crew.secure")
  private data: StoreData = {}

  constructor() {
    try {
      const raw = readFileSync(this.file)
      const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8")
      this.data = JSON.parse(text) as StoreData
    } catch {
      this.data = {}
    }
  }

  get<K extends keyof StoreData>(key: K): StoreData[K] {
    return this.data[key]
  }

  set<K extends keyof StoreData>(key: K, value: StoreData[K]) {
    if (value === undefined) delete this.data[key]
    else this.data[key] = value
    const text = JSON.stringify(this.data)
    writeFileSync(this.file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text, { mode: 0o600 })
  }
}

let store: SecureStore | undefined
export const secureStore = () => (store ??= new SecureStore())

export const DEFAULT_SERVER_URL = import.meta.env.MAIN_VITE_SERVER_URL ?? "http://localhost:8787"
export const serverUrl = () => (secureStore().get("serverUrl") ?? DEFAULT_SERVER_URL).replace(/\/$/, "")
