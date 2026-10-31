// The one place that talks to the Crew server. Every call carries the
// session as a bearer token; the token lives in the OS keychain via main.

let base = ""
let token: string | null = null
const unauthorized = new Set<() => void>()

export async function initApi() {
  const config = await window.crew.config()
  base = config.serverUrl
  token = await window.crew.session.get()
  return { config, signedIn: !!token }
}

export const serverBase = () => base
export const sessionToken = () => token
export const onUnauthorized = (fn: () => void) => {
  unauthorized.add(fn)
  return () => void unauthorized.delete(fn)
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  } catch {
    throw new ApiError(`Can't reach the Crew server at ${base}.`, 0)
  }
  if (res.status === 401 && token) unauthorized.forEach((fn) => fn())
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError((data as { error?: string; message?: string }).error ?? (data as { message?: string }).message ?? res.statusText, res.status)
  return data as T
}

async function authCall(path: string, body: Record<string, string>) {
  let res: Response
  try {
    res = await fetch(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Can't reach the Crew server at ${base}.`, 0)
  }
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  if (!res.ok) throw new ApiError(data.message ?? "Sign-in failed", res.status)
  const next = res.headers.get("set-auth-token")
  if (!next) throw new ApiError("The server didn't return a session.", 500)
  token = next
  await window.crew.session.set(next)
}

export const auth = {
  signIn: (email: string, password: string) => authCall("sign-in/email", { email, password }),
  signUp: (name: string, email: string, password: string) => authCall("sign-up/email", { name, email, password }),
  async signOut() {
    await fetch(`${base}/api/auth/sign-out`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }).catch(() => {})
    token = null
    await window.crew.session.set(null)
  },
  async setServer(url: string | null) {
    await window.crew.setServerUrl(url)
    base = (await window.crew.config()).serverUrl
  },
}
