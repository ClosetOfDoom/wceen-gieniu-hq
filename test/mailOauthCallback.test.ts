// The Google OAuth callback is open to the browser (no password header), so it must refuse everything without a valid signed state,
// before it talks to Google or to the store.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain JS module
import callback from '../netlify/functions/mail-oauth-callback.js'
// @ts-expect-error plain JS module
import { signState } from '../netlify/shared/googleAuth.js'

const SECRET = 'pw-for-tests'
const saved = { ...process.env }
beforeEach(() => {
  process.env.STANLEY_ACCESS_TOKEN = SECRET
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
})
afterEach(() => { process.env = { ...saved }; vi.unstubAllGlobals() })

const call = (qs: string) => callback(new Request(`https://x.netlify.app/.netlify/functions/mail-oauth-callback?${qs}`))

describe('mail-oauth-callback', () => {
  it('no state, a forged state or an expired state: refused, and Google is never contacted', async () => {
    for (const qs of ['code=abc', 'code=abc&state=forged.sig', `code=abc&state=${signState('other-secret')}`, `code=abc&state=${signState(SECRET, Date.now() - 11 * 60 * 1000)}`]) {
      const r = await call(qs)
      expect(r.status, qs).toBe(400)
      expect(await r.text()).toContain('expired or is not valid')
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('a valid state but Google reports an error or sends no code: nothing is saved', async () => {
    const state = signState(SECRET)
    expect(await (await call(`error=access_denied&state=${state}`)).text()).toContain('did not grant access')
    expect(await (await call(`state=${state}`)).text()).toContain('sent no code')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('a valid state and a code, but the Google client is not configured: a plain failure page, no secrets', async () => {
    const r = await call(`code=abc&state=${signState(SECRET)}`)
    expect(r.status).toBe(400)
    const html = await r.text()
    expect(html).toContain('Google was not connected')
    expect(html).toContain('GOOGLE_CLIENT_ID')
    expect(html).not.toContain(SECRET)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })
  it('with no password configured on the server nothing verifies (closed, never open)', async () => {
    const state = signState(SECRET)
    delete process.env.STANLEY_ACCESS_TOKEN
    expect((await call(`code=abc&state=${state}`)).status).toBe(400)
  })
})
