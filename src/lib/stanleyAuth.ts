// stanleyAuth.ts — the shared password for the Netlify functions, and the ONE fetch wrapper.
//
// Every call to /.netlify/functions/* goes through stanleyFetch(), which adds the password
// header (x-stanley-token). Nothing else in src/ may call a function with plain fetch() —
// scripts/assert-stanley-auth.mjs greps for that. The password is only ever in localStorage
// (and in memory when storage is blocked); it is never logged and never put in a URL.

export const TOKEN_HEADER = 'x-stanley-token'
const STORAGE_KEY = 'stanley.access.token'
/** Cheap function without database access: a 200 here proves the password is right. */
const CHECK_URL = '/.netlify/functions/tts-health'

let memoryToken: string | null = null
const listeners = new Set<() => void>()

export function getToken(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return stored
  } catch { /* storage blocked: fall back to memory */ }
  return memoryToken
}

export function setToken(token: string): void {
  memoryToken = token
  try { window.localStorage.setItem(STORAGE_KEY, token) } catch { /* memory only */ }
}

export function clearToken(): void {
  memoryToken = null
  try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* nothing to clear */ }
}

/** Called whenever the stored password is cleared or rejected, so the login screen can come back. */
export function onAuthLost(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notifyAuthLost(): void {
  listeners.forEach((l) => l())
}

export function logout(): void {
  clearToken()
  notifyAuthLost()
}

/** fetch() for /.netlify/functions/* — adds the password header; a 401 drops the stored password. */
export async function stanleyFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init.headers)
  if (token) headers.set(TOKEN_HEADER, token)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 && token) {
    clearToken()
    notifyAuthLost()
  }
  return res
}

export type PasswordCheck = 'ok' | 'wrong' | 'unconfigured' | 'unreachable'

/** Tries a candidate password against the server without storing it. */
export async function checkPassword(candidate: string): Promise<PasswordCheck> {
  try {
    const res = await fetch(CHECK_URL, { headers: { [TOKEN_HEADER]: candidate }, cache: 'no-store' })
    if (res.status === 401) return 'wrong'
    if (res.status === 503) return 'unconfigured'
    return res.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}
