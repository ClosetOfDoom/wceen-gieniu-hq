// googleAuth.js — Google OAuth 2.0 for Stanley's mailbox (Gmail API). No googleapis package: plain fetch, injectable for tests.
//
// Scopes (only these two):
//   gmail.modify  read, labels, archive. It cannot delete permanently.
//   gmail.send    send the approved replies.
// The app is an "Internal" OAuth app of the foundation's Google Workspace: no Google verification and the refresh token
// does not expire after 7 days (as it does for an External app in "Testing").
//
// Tokens live in the "stanley" Blobs store under google/tokens (the KV from webinarMailStore.js, the one path to Blobs).
// The refresh token never reaches the browser, a log or a response. Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (the only new ones).
//
// The OAuth `state` is an HMAC-signed, 10-minute token minted only for an authenticated request (secret: STANLEY_ACCESS_TOKEN),
// so the callback (which cannot carry the password header, Google redirects the browser to it) cannot be used by a stranger.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const GOOGLE_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
])
export const TOKENS_KEY = 'google/tokens'
export const STATE_TTL_MS = 10 * 60 * 1000
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export class GoogleAuthError extends Error {
  constructor(message, { code = 'google_error', status = null } = {}) {
    super(message)
    this.name = 'GoogleAuthError'
    this.code = code
    this.status = status
  }
}

export function googleConfigFromEnv(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) throw new GoogleAuthError('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing', { code: 'not_configured' })
  return { clientId, clientSecret }
}

export function redirectUriFor(origin) {
  return `${String(origin).replace(/\/+$/, '')}/.netlify/functions/mail-oauth-callback`
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────

export function signState(secret, now = Date.now()) {
  if (!secret) throw new GoogleAuthError('no signing secret', { code: 'not_configured' })
  const body = Buffer.from(JSON.stringify({ n: randomBytes(9).toString('base64url'), t: now })).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

export function verifyState(state, secret, now = Date.now()) {
  const m = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(state ?? ''))
  if (!m || !secret) return false
  const want = createHmac('sha256', secret).update(m[1]).digest()
  let got
  try { got = Buffer.from(m[2], 'base64url') } catch { return false }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false
  try {
    const { t } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    return Number.isFinite(t) && now - t >= 0 && now - t <= STATE_TTL_MS
  } catch { return false }
}

export function buildAuthUrl({ clientId, redirectUri, state }) {
  const u = new URL(AUTH_URL)
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  u.searchParams.set('access_type', 'offline') // a refresh token
  u.searchParams.set('prompt', 'consent') // Google returns the refresh token only on a fresh consent
  u.searchParams.set('state', state)
  return u.toString()
}

// ── token endpoint ──────────────────────────────────────────────────────────────────────────────────

async function tokenCall(params, fetchImpl) {
  let res
  try {
    res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() })
  } catch (e) {
    throw new GoogleAuthError(`Google token endpoint unreachable: ${e.message}`, { code: 'network' })
  }
  let data = null
  try { data = await res.json() } catch { /* not JSON */ }
  if (!res.ok) {
    const code = data?.error === 'invalid_grant' ? 'invalid_grant' : 'google_error'
    throw new GoogleAuthError(`Google refused the token request (HTTP ${res.status}${data?.error ? `, ${data.error}` : ''})`, { code, status: res.status })
  }
  return data
}

export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now() }) {
  const t = await tokenCall({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }, fetchImpl)
  if (!t?.refresh_token) throw new GoogleAuthError('Google returned no refresh token (revoke the app in the Google account and connect again)', { code: 'no_refresh_token' })
  const granted = String(t.scope ?? '').split(/\s+/)
  const missing = GOOGLE_SCOPES.filter((s) => !granted.includes(s))
  if (missing.length) throw new GoogleAuthError(`The consent did not include: ${missing.map((s) => s.split('/').pop()).join(', ')}`, { code: 'missing_scope' })
  return { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: now + (Number(t.expires_in) || 3600) * 1000, scope: t.scope }
}

/**
 * The token session of the connected mailbox.
 *   getAccessToken()  a valid access token (refreshed and stored when it expires within 60 s)
 *   status()          { connected, connectedAt, email? }, never any token
 *   save(tokens, email?)  /  disconnect()
 */
export function createGoogleSession({ kv, env = process.env, fetchImpl = fetch, now = () => Date.now() }) {
  return {
    async status() {
      const t = await kv.getJSON(TOKENS_KEY)
      return t?.refresh_token ? { connected: true, connectedAt: t.connectedAt ?? null, email: t.email ?? null, invalid: Boolean(t.invalid) } : { connected: false, connectedAt: null, email: null, invalid: false }
    },
    async save(tokens, email = null) {
      await kv.setJSON(TOKENS_KEY, { ...tokens, email, invalid: false, connectedAt: new Date(now()).toISOString() })
    },
    async getAccessToken() {
      const t = await kv.getJSON(TOKENS_KEY)
      if (!t?.refresh_token) throw new GoogleAuthError('Google is not connected', { code: 'not_connected' })
      if (t.access_token && t.expires_at - now() > 60_000) return t.access_token
      const { clientId, clientSecret } = googleConfigFromEnv(env)
      let fresh
      try {
        fresh = await tokenCall({ refresh_token: t.refresh_token, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }, fetchImpl)
      } catch (e) {
        if (e.code === 'invalid_grant') await kv.setJSON(TOKENS_KEY, { ...t, access_token: null, expires_at: 0, invalid: true }) // access revoked: the panel shows "connect again"
        throw e
      }
      const next = { ...t, access_token: fresh.access_token, expires_at: now() + (Number(fresh.expires_in) || 3600) * 1000 }
      await kv.setJSON(TOKENS_KEY, next)
      return next.access_token
    },
    async disconnect() {
      const t = await kv.getJSON(TOKENS_KEY)
      if (t?.refresh_token) {
        try { await fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }) } catch { /* revoking is best effort; the tokens are deleted anyway */ }
      }
      await kv.delete(TOKENS_KEY)
    },
  }
}
