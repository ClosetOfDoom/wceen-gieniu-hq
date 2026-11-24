// publisherClient.js — the ONLY door from Stanley to the reel Publisher: POST/GET {PUBLISHER_URL}/api/zewn with
// Authorization: Bearer <STANLEY_PUBLISHER_TOKEN>. The Publisher is the single source of truth for the queue;
// Stanley keeps no copy of it. Every change goes through the Publisher's own rules (past dates and collisions are
// rejected there, a change outside the slot comes back as a warning), and dry_run=true validates without writing.
//
// Errors carry what the Publisher said: PublisherError.code is the HTTP status (number) or a word
// ('timeout' | 'unreachable' | 'not-configured'); .message is the Publisher's own `blad` text for 4xx.
// The token is never logged, returned or put in a message.

export class PublisherError extends Error {
  /** @param {number|string} code @param {string} message @param {boolean} [validation] true = the Publisher refused the request (4xx with a reason) */
  constructor(code, message, validation = false) {
    super(message)
    this.name = 'PublisherError'
    this.code = code
    this.validation = validation
  }
}

/** Full /api/zewn address from PUBLISHER_URL (accepts the site address or the full endpoint). */
export function zewnUrl(base) {
  const u = new URL(String(base).trim())
  const path = u.pathname.replace(/\/+$/, '')
  u.pathname = path.endsWith('/api/zewn') ? path : `${path}/api/zewn`
  u.search = ''
  u.hash = ''
  return u.toString()
}

export function publisherConfigFromEnv(env = process.env) {
  const token = String(env.STANLEY_PUBLISHER_TOKEN ?? '').trim()
  const url = String(env.PUBLISHER_URL ?? '').trim()
  if (!token || !url) throw new PublisherError('not-configured', 'Publisher is not configured (STANLEY_PUBLISHER_TOKEN / PUBLISHER_URL missing).')
  try { return { token, url: zewnUrl(url) } } catch { throw new PublisherError('not-configured', 'PUBLISHER_URL is not a valid address.') }
}

export function createPublisherClient({ url, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  async function call(body) {
    let res
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      throw new PublisherError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'unreachable', 'Publisher did not answer.')
    }
    const text = await res.text().catch(() => '')
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    if (!res.ok) {
      const reason = typeof json?.blad === 'string' ? json.blad : ''
      // 400 / 422 carry the Publisher's reason (validation); everything else is "API unavailable".
      throw new PublisherError(res.status, reason || `Publisher API returned ${res.status}.`, (res.status === 400 || res.status === 422) && Boolean(reason))
    }
    if (json === null) throw new PublisherError(res.status, 'Publisher returned a response that is not JSON.')
    return json
  }

  return {
    plan: ({ od, do: doDnia } = {}) => call({ akcja: 'plan', ...(od ? { od } : {}), ...(doDnia ? { do: doDnia } : {}) }),
    status: () => call({ akcja: 'status' }),
    /** action: 'przesun' | 'zamien' | 'wstrzymaj' | 'wznow'; params as the API wants them. */
    change: (action, params, { dryRun }) => call({ akcja: action, ...params, dry_run: Boolean(dryRun) }),
  }
}
