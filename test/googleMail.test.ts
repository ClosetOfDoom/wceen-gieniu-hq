// Google OAuth (state, code exchange, refresh, revoke) and the Gmail client (MIME, labels, no destructive calls).
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain JS module
import { signState, verifyState, buildAuthUrl, exchangeCode, createGoogleSession, googleConfigFromEnv, redirectUriFor, GOOGLE_SCOPES, STATE_TTL_MS, TOKENS_KEY } from '../netlify/shared/googleAuth.js'
// @ts-expect-error plain JS module
import { createGmailClient, buildMime, parseAddress, normalizeMessage, isPlainAddress } from '../netlify/shared/gmailClient.js'
// @ts-expect-error plain JS module
import { createMemoryKv } from '../netlify/shared/webinarMailStore.js'
import { readFileSync } from 'node:fs'

const SECRET = 'test-secret'
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('OAuth state', () => {
  it('a signed state verifies for 10 minutes and not after, not from the future, not with another secret', () => {
    const t = 1_000_000
    const s = signState(SECRET, t)
    expect(verifyState(s, SECRET, t + 1000)).toBe(true)
    expect(verifyState(s, SECRET, t + STATE_TTL_MS)).toBe(true)
    expect(verifyState(s, SECRET, t + STATE_TTL_MS + 1)).toBe(false)
    expect(verifyState(s, SECRET, t - 1)).toBe(false)
    expect(verifyState(s, 'other', t + 1000)).toBe(false)
  })
  it('garbage, a tampered body and an empty secret are refused', () => {
    const s = signState(SECRET, 5)
    expect(verifyState('', SECRET, 5)).toBe(false)
    expect(verifyState(undefined, SECRET, 5)).toBe(false)
    expect(verifyState('a.b', SECRET, 5)).toBe(false)
    const [body, sig] = s.split('.')
    const forged = `${Buffer.from(JSON.stringify({ n: 'x', t: 5 })).toString('base64url')}.${sig}`
    expect(verifyState(forged, SECRET, 5)).toBe(false)
    expect(verifyState(`${body}.${sig}`, '', 5)).toBe(false)
    expect(() => signState('')).toThrow()
  })
})

describe('consent URL and config', () => {
  it('asks for exactly gmail.modify and gmail.send, offline, with consent, and carries the state', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'https://app.example/.netlify/functions/mail-oauth-callback', state: 'st' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('scope')!.split(' ')).toEqual(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'])
    expect(u.searchParams.get('access_type')).toBe('offline')
    expect(u.searchParams.get('prompt')).toBe('consent')
    expect(u.searchParams.get('state')).toBe('st')
    expect(GOOGLE_SCOPES.some((s: string) => /mail\.google\.com|gmail\.readonly$/.test(s))).toBe(false) // never the full-access scope
  })
  it('the redirect URI is the callback function; the client id and secret must both be set', () => {
    expect(redirectUriFor('https://x.netlify.app/')).toBe('https://x.netlify.app/.netlify/functions/mail-oauth-callback')
    expect(() => googleConfigFromEnv({})).toThrow('GOOGLE_CLIENT_ID')
    expect(() => googleConfigFromEnv({ GOOGLE_CLIENT_ID: 'a' })).toThrow()
    expect(googleConfigFromEnv({ GOOGLE_CLIENT_ID: ' a ', GOOGLE_CLIENT_SECRET: ' b ' })).toEqual({ clientId: 'a', clientSecret: 'b' })
  })
})

describe('code exchange', () => {
  const ok = { refresh_token: 'RT', access_token: 'AT', expires_in: 3600, scope: GOOGLE_SCOPES.join(' ') }
  it('returns the tokens with an absolute expiry', async () => {
    const fetchImpl = vi.fn(async () => json(200, ok))
    const t = await exchangeCode({ code: 'c', clientId: 'cid', clientSecret: 'sec', redirectUri: 'r', fetchImpl, now: 1000 })
    expect(t).toMatchObject({ refresh_token: 'RT', access_token: 'AT', expires_at: 1000 + 3_600_000 })
    const [, init] = fetchImpl.mock.calls[0] as any
    expect(String(init.body)).toContain('grant_type=authorization_code')
  })
  it('no refresh token, a missing scope (the user unticked a box) or a Google error: nothing is saved', async () => {
    await expect(exchangeCode({ code: 'c', clientId: 'a', clientSecret: 'b', redirectUri: 'r', fetchImpl: async () => json(200, { ...ok, refresh_token: undefined }) })).rejects.toMatchObject({ code: 'no_refresh_token' })
    await expect(exchangeCode({ code: 'c', clientId: 'a', clientSecret: 'b', redirectUri: 'r', fetchImpl: async () => json(200, { ...ok, scope: GOOGLE_SCOPES[0] }) })).rejects.toMatchObject({ code: 'missing_scope' })
    await expect(exchangeCode({ code: 'c', clientId: 'a', clientSecret: 'b', redirectUri: 'r', fetchImpl: async () => json(400, { error: 'invalid_grant' }) })).rejects.toMatchObject({ code: 'invalid_grant' })
  })
})

describe('Google session (tokens in the KV)', () => {
  const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' }
  it('status never exposes a token; getAccessToken reuses a fresh token and refreshes an expiring one', async () => {
    const kv = createMemoryKv()
    let now = 10_000
    const fetchImpl = vi.fn(async () => json(200, { access_token: 'AT2', expires_in: 3600 }))
    const s = createGoogleSession({ kv, env, fetchImpl, now: () => now })
    expect(await s.status()).toMatchObject({ connected: false })
    await expect(s.getAccessToken()).rejects.toMatchObject({ code: 'not_connected' })
    await s.save({ refresh_token: 'RT', access_token: 'AT1', expires_at: now + 3_600_000, scope: 'x' }, 'me@example.org')
    const st = await s.status()
    expect(st).toMatchObject({ connected: true, email: 'me@example.org', invalid: false })
    expect(JSON.stringify(st)).not.toMatch(/RT|AT1/)
    expect(await s.getAccessToken()).toBe('AT1')
    expect(fetchImpl).not.toHaveBeenCalled()
    now += 3_600_000 - 30_000 // inside the 60 s margin
    expect(await s.getAccessToken()).toBe('AT2')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String((fetchImpl.mock.calls[0] as any)[1].body)).toContain('grant_type=refresh_token')
    expect((await kv.getJSON(TOKENS_KEY)).refresh_token).toBe('RT') // the refresh token survives a refresh
  })
  it('a revoked grant marks the connection invalid (the panel says "connect again")', async () => {
    const kv = createMemoryKv()
    const s = createGoogleSession({ kv, env, fetchImpl: async () => json(400, { error: 'invalid_grant' }), now: () => 5 })
    await s.save({ refresh_token: 'RT', access_token: null, expires_at: 0, scope: 'x' })
    await expect(s.getAccessToken()).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(await s.status()).toMatchObject({ connected: true, invalid: true })
  })
  it('disconnect revokes at Google and deletes the tokens, even if the revoke call fails', async () => {
    const kv = createMemoryKv()
    const fetchImpl = vi.fn(async () => { throw new Error('offline') })
    const s = createGoogleSession({ kv, env, fetchImpl, now: () => 5 })
    await s.save({ refresh_token: 'RT', access_token: 'A', expires_at: 9e12, scope: 'x' })
    await s.disconnect()
    expect(String((fetchImpl.mock.calls[0] as any)[0])).toContain('oauth2.googleapis.com/revoke')
    expect(await kv.getJSON(TOKENS_KEY)).toBeNull()
    expect(await s.status()).toMatchObject({ connected: false })
  })
})

describe('Gmail client', () => {
  it('parses addresses and refuses anything that is not one plain address', () => {
    expect(parseAddress('Anna Kowalska <Anna.K@Gmail.com>')).toEqual({ name: 'Anna Kowalska', address: 'anna.k@gmail.com' })
    expect(parseAddress('b@c.pl')).toEqual({ name: '', address: 'b@c.pl' })
    expect(parseAddress('')).toEqual({ name: '', address: '' })
    expect(isPlainAddress('a@b.pl')).toBe(true)
    for (const bad of ['a@b.pl, c@d.pl', 'a@b.pl\r\nBcc: x@y.pl', 'Name <a@b.pl>', 'a b@c.pl', '']) expect(isPlainAddress(bad), bad).toBe(false)
  })
  it('normalizeMessage: lower-cased addresses, bulk detection, snippet trimmed, no body', () => {
    const m = normalizeMessage({ id: '1', threadId: 't', labelIds: ['INBOX'], snippet: 'x'.repeat(900), internalDate: '1700000000000', payload: { headers: [{ name: 'From', value: 'A <A@B.pl>' }, { name: 'Subject', value: 'Hej' }, { name: 'List-Unsubscribe', value: '<mailto:x>' }, { name: 'Message-ID', value: '<id@x>' }] } })
    expect(m).toMatchObject({ id: '1', threadId: 't', from: 'a@b.pl', subject: 'Hej', bulk: true, messageId: '<id@x>' })
    expect(m.snippet.length).toBe(400)
    expect(normalizeMessage({ id: '2', payload: { headers: [{ name: 'Auto-Submitted', value: 'no' }] } }).bulk).toBe(false)
    expect(normalizeMessage({ id: '3', payload: { headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] } }).bulk).toBe(true)
  })
  it('buildMime: multipart alternative, UTF-8 subject encoded, threading headers, base64 parts that decode', () => {
    const mime = buildMime({ to: 'a@b.pl', subject: 'Twój dostęp – Pakiet', plain: 'Dzień dobry zażółć', html: '<p>Dzień dobry zażółć</p>', inReplyTo: '<x@y>', references: '<w@y>' })
    expect(mime).toContain('To: a@b.pl')
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/)
    expect(Buffer.from(/Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(mime)![1], 'base64').toString('utf8')).toBe('Twój dostęp – Pakiet')
    expect(mime).toContain('In-Reply-To: <x@y>')
    expect(mime).toContain('References: <w@y> <x@y>')
    expect(mime).toContain('Content-Type: multipart/alternative')
    const parts = [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'))
    expect(parts).toEqual(['Dzień dobry zażółć', '<p>Dzień dobry zażółć</p>'])
  })
  it('buildMime cannot be used for header injection', () => {
    expect(() => buildMime({ to: 'a@b.pl\r\nBcc: v@x.pl', subject: 's', plain: 'p', html: 'h' })).toThrow()
    const mime = buildMime({ to: 'a@b.pl', subject: 'Hi\r\nBcc: v@x.pl', plain: 'p', html: 'h', inReplyTo: '<x@y>\r\nBcc: v@x.pl' })
    expect(mime.split('\r\n\r\n')[0]).not.toMatch(/^Bcc:/m)
  })
  it('lists, reads metadata with the right fields, labels, sends in the thread; the Bearer token is used', async () => {
    const calls: Array<{ url: string; method: string; body?: any; auth?: string }> = []
    const fetchImpl = vi.fn(async (url: string, init: any = {}) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization })
      if (url.includes('/messages?')) return json(200, { messages: [{ id: 'a' }, { id: 'b' }] })
      if (url.endsWith('/labels') && init.method !== 'POST') return json(200, { labels: [{ id: 'L1', name: 'STANLEY/replied' }] })
      if (url.endsWith('/labels')) return json(200, { id: 'L2', name: 'STANLEY/skipped' })
      if (url.includes('/messages/send')) return json(200, { id: 'S1', threadId: 'T1' })
      if (url.includes('/modify')) return json(200, {})
      if (url.includes('/messages/a?')) return json(200, { id: 'a', payload: { headers: [] } })
      return json(404, { error: { status: 'NOT_FOUND' } })
    })
    const g = createGmailClient({ getToken: async () => 'TOK', fetchImpl: fetchImpl as any })
    expect(await g.listIds('in:inbox', 5)).toEqual(['a', 'b'])
    await g.getMeta('a')
    const metaUrl = new URL(calls.find((c) => c.url.includes('/messages/a?'))!.url)
    expect(metaUrl.searchParams.get('format')).toBe('metadata') // never format=full: no body is read
    expect(metaUrl.searchParams.getAll('metadataHeaders')).toEqual(expect.arrayContaining(['From', 'Subject', 'Message-ID', 'List-Unsubscribe']))
    await g.modifyLabels('a', { add: ['STANLEY/replied', 'STANLEY/skipped'] })
    const mod = calls.find((c) => c.url.includes('/messages/a/modify'))!
    expect(mod.body.addLabelIds).toEqual(['L1', 'L2'])
    const sent = await g.send({ to: 'x@y.pl', subject: 'S', plain: 'p', html: 'h', threadId: 'T1' })
    expect(sent).toEqual({ id: 'S1', threadId: 'T1' })
    expect(calls.find((c) => c.url.endsWith('/messages/send'))!.body).toMatchObject({ threadId: 'T1' })
    expect(calls.every((c) => c.auth === 'Bearer TOK')).toBe(true)
    expect(calls.some((c) => c.method === 'DELETE' || /\/trash|\/delete|batchDelete/.test(c.url))).toBe(false)
  })
  it('API errors carry a code and no message content', async () => {
    const g = createGmailClient({ getToken: async () => 'T', fetchImpl: (async () => json(403, { error: { status: 'PERMISSION_DENIED', message: 'secret@x.pl' } })) as any })
    await expect(g.profile()).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await expect(g.profile()).rejects.not.toThrow(/secret@x\.pl/)
  })
})

describe('the Gmail client has no destructive call', () => {
  it('source: no trash, delete or batchDelete endpoint, and the scopes cannot delete', () => {
    const src = readFileSync(new URL('../netlify/shared/gmailClient.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    expect(src).not.toMatch(/trash|batchDelete|method:\s*'DELETE'|\/delete/i)
    expect(GOOGLE_SCOPES).toEqual(['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'])
  })
})
