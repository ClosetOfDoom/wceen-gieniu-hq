// auth.js — the ONE access guard for every Netlify function of this site.
//
// A shared password (env STANLEY_ACCESS_TOKEN, set in the Netlify GUI) must arrive in the
// x-stanley-token request header. The value is never logged, returned or written anywhere.
//
//   no env variable on the server  -> 503, empty body (closed, never open)
//   header missing or wrong        -> 401, empty body
//   header equals the variable     -> the wrapped handler runs
//
// OPTIONS (CORS preflight) is answered before the check: browsers never send custom headers on
// a preflight, and it carries no data. CORS is limited to the app's own origin.
//
// Usage in a function:   export const handler = withStanleyAuth(async (event, context) => { ... })
//   (Functions API v2:     export default withStanleyAuthV2(async (req, context) => new Response(...)))

import { createHash, timingSafeEqual } from 'node:crypto'

export const TOKEN_HEADER = 'x-stanley-token'

/** Production origin of the app; used when Netlify does not provide URL (e.g. in tests). */
export const DEFAULT_APP_ORIGIN = 'https://elegant-kelpie-6fdfc8.netlify.app'

/** Origin the browser is allowed to call from: the site's own URL, nothing else. */
export function appOrigin(env = process.env) {
  const raw = (env.URL || DEFAULT_APP_ORIGIN).trim()
  try { return new URL(raw).origin } catch { return DEFAULT_APP_ORIGIN }
}

function headerValue(headers, name) {
  if (!headers) return ''
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) return String(headers[key] ?? '')
  }
  return ''
}

/** Constant-time comparison: both sides are hashed first, so length does not leak either. */
export function tokensMatch(given, expected) {
  const a = createHash('sha256').update(String(given), 'utf8').digest()
  const b = createHash('sha256').update(String(expected), 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** 'ok' | 'unconfigured' (503) | 'denied' (401) */
export function checkAccess(event, env = process.env) {
  const expected = env.STANLEY_ACCESS_TOKEN
  if (typeof expected !== 'string' || expected.trim() === '') return 'unconfigured'
  const given = headerValue(event?.headers, TOKEN_HEADER)
  if (!given) return 'denied'
  return tokensMatch(given, expected) ? 'ok' : 'denied'
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': appOrigin(env),
    'Access-Control-Allow-Headers': `Content-Type, ${TOKEN_HEADER}`,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

/**
 * @param {(event: any, context?: any) => Promise<any>} inner
 * @param {{ env?: NodeJS.ProcessEnv }} [options]  env is injectable for tests; default process.env at call time
 */
export function withStanleyAuth(inner, options = {}) {
  return async (event, context) => {
    const env = options.env ?? process.env
    const cors = corsHeaders(env)
    if (event?.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' }

    const access = checkAccess(event, env)
    if (access === 'unconfigured') return { statusCode: 503, headers: { ...cors, 'Cache-Control': 'no-store' }, body: '' }
    if (access === 'denied') return { statusCode: 401, headers: { ...cors, 'Cache-Control': 'no-store' }, body: '' }

    const res = await inner(event, context)
    // The app's origin replaces whatever CORS the function set before (it used to be "*").
    return { ...res, headers: { ...(res?.headers ?? {}), ...cors } }
  }
}

/**
 * The same guard for a Functions API v2 function (`export default withStanleyAuthV2(async (req, context) => Response)`).
 * One check (checkAccess), one CORS policy: only the shape changes (Request/Response instead of event/{statusCode}).
 * @param {(req: Request, context?: any) => Promise<Response>} inner
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
export function withStanleyAuthV2(inner, options = {}) {
  return async (req, context) => {
    const env = options.env ?? process.env
    const cors = corsHeaders(env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const access = checkAccess({ headers: Object.fromEntries(req.headers) }, env)
    if (access === 'unconfigured') return new Response(null, { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } })
    if (access === 'denied') return new Response(null, { status: 401, headers: { ...cors, 'Cache-Control': 'no-store' } })

    const res = await inner(req, context)
    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries(cors)) headers.set(k, v)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
}
