// Wspólne hasło (x-stanley-token) dla WSZYSTKICH funkcji Netlify. Wartość testowa, nie prawdziwe hasło.
// Dla każdej funkcji: bez nagłówka 401, zły 401, dobry → handler się wykonuje (sieć podstawiona), brak zmiennej 503.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APP_ORIGIN, appOrigin, checkAccess, tokensMatch, withStanleyAuth } from '../netlify/shared/auth.js'

const TEST_TOKEN = 'test-token-not-a-real-password'
const FUNCTIONS = [
  'gieniu-command', 'finance-data', 'campaign-data', 'data-health', 'ops-week-report', 'orders-data', 'product-sales',
  'profit-data', 'spend-split', 'webinar-attendees', 'webinar-data', 'tts-health', 'eleven-voices', 'eleven-tts',
  'eleven-voice-test', 'gieniu-tts',
] as const

type Handler = (event: Record<string, unknown>, context?: unknown) => Promise<{ statusCode: number; headers?: Record<string, string>; body?: string }>
const load = async (name: string): Promise<Handler> => (await import(/* @vite-ignore */ `../netlify/functions/${name}.js`)).handler

// metoda i treść, z którymi funkcja ma sens (POST dla gieniu-command, eleven-*, gieniu-tts)
const REQUESTS: Record<string, Record<string, unknown>> = {
  'gieniu-command': { httpMethod: 'POST', body: JSON.stringify({ message: 'hello', context: {} }) },
  'eleven-tts': { httpMethod: 'POST', body: JSON.stringify({ text: 'test' }) },
  'eleven-voice-test': { httpMethod: 'POST', body: JSON.stringify({ text: 'test' }) },
  'gieniu-tts': { httpMethod: 'POST', body: JSON.stringify({ text: 'test' }) },
  'finance-data': { httpMethod: 'GET', queryStringParameters: { months: '2026-10' } },
  'spend-split': { httpMethod: 'GET', queryStringParameters: { from: '2026-10-01', to: '2026-10-07' } },
  'webinar-attendees': { httpMethod: 'GET', queryStringParameters: { room: '1', session: '2' } },
}
const request = (name: string, headers?: Record<string, string>) => ({ httpMethod: 'GET', queryStringParameters: {}, ...(REQUESTS[name] ?? {}), headers })

beforeEach(() => {
  // sieć podstawiona: każde wywołanie zewnętrzne (Supabase, ElevenLabs, model) dostaje pusty JSON 200
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })))
  vi.stubEnv('STANLEY_ACCESS_TOKEN', TEST_TOKEN)
  vi.stubEnv('SUPABASE_URL', 'https://example.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  vi.stubEnv('ELEVENLABS_API_KEY', 'test-eleven-key')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('moduł autoryzacji', () => {
  it('tokensMatch: równe tak, różne i różnej długości nie', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true)
    expect(tokensMatch('abc', 'abd')).toBe(false)
    expect(tokensMatch('abc', 'abcd')).toBe(false)
    expect(tokensMatch('', 'abc')).toBe(false)
  })

  it('checkAccess: brak zmiennej → unconfigured (także przy pustej), zły/brak nagłówka → denied, dobry → ok, nagłówek bez względu na wielkość liter', () => {
    expect(checkAccess({ headers: { 'x-stanley-token': 'x' } }, {})).toBe('unconfigured')
    expect(checkAccess({ headers: { 'x-stanley-token': 'x' } }, { STANLEY_ACCESS_TOKEN: '   ' })).toBe('unconfigured')
    expect(checkAccess({ headers: {} }, { STANLEY_ACCESS_TOKEN: 't' })).toBe('denied')
    expect(checkAccess({}, { STANLEY_ACCESS_TOKEN: 't' })).toBe('denied')
    expect(checkAccess({ headers: { 'x-stanley-token': 'zly' } }, { STANLEY_ACCESS_TOKEN: 't' })).toBe('denied')
    expect(checkAccess({ headers: { 'X-Stanley-Token': 't' } }, { STANLEY_ACCESS_TOKEN: 't' })).toBe('ok')
  })

  it('appOrigin: origin witryny z URL Netlify, z awaryjną wartością produkcyjną; nigdy "*"', () => {
    expect(appOrigin({ URL: 'https://moja.example/' })).toBe('https://moja.example')
    expect(appOrigin({})).toBe(DEFAULT_APP_ORIGIN)
    expect(appOrigin({ URL: 'not a url' })).toBe(DEFAULT_APP_ORIGIN)
  })

  it('wrapper: preflight OPTIONS bez hasła → 204 z CORS tylko dla origin aplikacji; odpowiedź funkcji dostaje ten origin zamiast "*"', async () => {
    const env = { STANLEY_ACCESS_TOKEN: 't', URL: 'https://app.example' }
    const h = withStanleyAuth(async () => ({ statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' }, body: 'x' }), { env })
    const pre = await h({ httpMethod: 'OPTIONS', headers: {} })
    expect(pre.statusCode).toBe(204)
    expect(pre.headers!['Access-Control-Allow-Origin']).toBe('https://app.example')
    expect(pre.headers!['Access-Control-Allow-Headers']).toContain('x-stanley-token')
    const ok = await h({ httpMethod: 'GET', headers: { 'x-stanley-token': 't' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers!['Access-Control-Allow-Origin']).toBe('https://app.example')
    expect(ok.headers!['Content-Type']).toBe('text/plain')
    const denied = await h({ httpMethod: 'GET', headers: {} })
    expect(denied.statusCode).toBe(401)
    expect(denied.body).toBe('')
  })
})

describe.each(FUNCTIONS)('funkcja %s', (name) => {
  it('bez nagłówka → 401 bez treści; zły nagłówek → 401 bez treści', async () => {
    const handler = await load(name)
    const none = await handler(request(name))
    expect(none.statusCode).toBe(401)
    expect(none.body).toBe('')
    const wrong = await handler(request(name, { 'x-stanley-token': 'zle-haslo' }))
    expect(wrong.statusCode).toBe(401)
    expect(wrong.body).toBe('')
    expect(fetch).not.toHaveBeenCalled() // odmowa przed jakimkolwiek odczytem danych i wywołaniem usług zewnętrznych
  })

  it('dobry nagłówek → handler się wykonuje (nie 401/503)', async () => {
    const handler = await load(name)
    const res = await handler(request(name, { 'x-stanley-token': TEST_TOKEN }))
    // eslint-disable-next-line no-console
    console.log(`AUTH-LOCAL ${name} good-header -> ${res.statusCode}`)
    expect([401, 503]).not.toContain(res.statusCode)
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe(appOrigin())
    expect(res.headers?.['Access-Control-Allow-Origin']).not.toBe('*')
  })

  it('brak zmiennej po stronie serwera → 503 (nie dostęp otwarty), także z nagłówkiem', async () => {
    vi.stubEnv('STANLEY_ACCESS_TOKEN', '')
    const handler = await load(name)
    const res = await handler(request(name, { 'x-stanley-token': TEST_TOKEN }))
    expect(res.statusCode).toBe(503)
    expect(res.body).toBe('')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('webinar-mail-admin (Functions API v2, Request → Response)', () => {
  type V2 = (req: Request, context?: unknown) => Promise<Response>
  const loadV2 = async (): Promise<V2> => (await import('../netlify/functions/webinar-mail-admin.js')).default as V2
  const req = (headers: Record<string, string> = {}, method = 'GET') => new Request('https://app.example/.netlify/functions/webinar-mail-admin', { method, headers })

  it('bez nagłówka / zły nagłówek → 401 bez treści (nie 500), bez dotykania Blobs i Wix', async () => {
    const h = await loadV2()
    for (const r of [req(), req({ 'x-stanley-token': 'zle-haslo' })]) {
      const res = await h(r)
      expect(res.status).toBe(401)
      expect(await res.text()).toBe('')
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin())
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('brak zmiennej → 503; OPTIONS → 204 z CORS aplikacji', async () => {
    const h = await loadV2()
    expect((await h(req({}, 'OPTIONS'))).status).toBe(204)
    vi.stubEnv('STANLEY_ACCESS_TOKEN', '')
    const res = await h(req({ 'x-stanley-token': TEST_TOKEN }))
    expect(res.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('dobry nagłówek → handler się wykonuje (bez kluczy Wix: 503 z komunikatem JSON, CORS aplikacji, nie "*")', async () => {
    vi.stubEnv('WIX_API_KEY', ''); vi.stubEnv('WIX_SITE_ID', '')
    const h = await loadV2()
    const res = await h(req({ 'x-stanley-token': TEST_TOKEN }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBeTruthy()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin())
  })
})

describe('webinar-mail-health (publiczny, tylko GET, tylko odczyt)', () => {
  type V2 = (req: Request) => Promise<Response>
  const loadH = async (): Promise<V2> => (await import('../netlify/functions/webinar-mail-health.js')).default as V2
  it('GET bez hasła → 200 z dokładnie dozwolonymi polami (bez Blobs lokalnie: blobsRead "error", nie 500); POST → 405', async () => {
    const h = await loadH()
    const res = await h(new Request('https://app.example/.netlify/functions/webinar-mail-health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['aktualnyNadawca', 'alarmy', 'auto', 'blobsRead', 'build', 'kolejka', 'liczbaOdbiorcow', 'nadawcy', 'nastepnaWysylka', 'odbiorcy', 'ostatnieWpisy', 'pauza'])
    expect(body.odbiorcy).toBe('Subskrybenci e-mail (SUBSCRIBED)')
    expect(['ok', 'error']).toContain(body.blobsRead)
    expect((await h(new Request('https://app.example/x', { method: 'POST', body: '{}' }))).status).toBe(405)
  })
})

describe('tts-health ?live=1 tylko po zalogowaniu', () => {
  it('bez hasła ?live=1 daje 401 i nie woła ElevenLabs; z hasłem wywołanie live idzie do ElevenLabs', async () => {
    const handler = await load('tts-health')
    const denied = await handler({ httpMethod: 'GET', queryStringParameters: { live: '1' }, headers: {} })
    expect(denied.statusCode).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
    await handler({ httpMethod: 'GET', queryStringParameters: { live: '1' }, headers: { 'x-stanley-token': TEST_TOKEN } })
    expect(fetch).toHaveBeenCalled()
  })
})
