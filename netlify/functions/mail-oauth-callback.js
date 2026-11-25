// Netlify Function (Functions API v2): mail-oauth-callback — where Google sends the browser after the consent.
//
// It cannot carry the shared-password header (a plain browser redirect), so it is protected by the signed `state`
// minted by mail-admin 'connect-url' (HMAC, 10 minutes). Without a valid state it does nothing. The refresh token is
// stored in Blobs and never shown. The page it returns says only whether it worked.

import { appOrigin } from '../shared/auth.js'
import { googleConfigFromEnv, redirectUriFor, verifyState, exchangeCode } from '../shared/googleAuth.js'
import { realMailDeps } from '../shared/mailDeps.js'

const page = (ok, message, origin) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stanley · Google</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f14;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:30rem;padding:2rem;text-align:center}h1{font-size:1.2rem;color:${ok ? '#34d399' : '#f87171'}}a{color:#fbbf24}</style></head>
<body><main><h1>${ok ? 'Google connected, sir.' : 'Google was not connected.'}</h1><p>${message}</p><p><a href="${origin}">Back to Stanley</a></p></main></body></html>`,
  { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
)

const scrub = (s) => String(s).replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').replace(/[<>&]/g, '').slice(0, 160)

export default async (req) => {
  const env = process.env
  const origin = appOrigin(env)
  const url = new URL(req.url)
  if (!verifyState(url.searchParams.get('state'), env.STANLEY_ACCESS_TOKEN)) return page(false, 'The link expired or is not valid. Press “Connect Google” in the Mail tab again.', origin)
  if (url.searchParams.get('error')) return page(false, 'Google did not grant access. Nothing was saved.', origin)
  const code = url.searchParams.get('code')
  if (!code) return page(false, 'Google sent no code.', origin)
  try {
    const { clientId, clientSecret } = googleConfigFromEnv(env)
    const tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri: redirectUriFor(origin) })
    const deps = realMailDeps(env)
    // The profile call uses the fresh access token; the address is kept only to show "connected as" in the panel.
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    await deps.session.save(tokens, profile?.emailAddress ?? null)
    return page(true, 'The mailbox is connected. You can close this tab.', origin)
  } catch (e) {
    console.error('[mail-oauth-callback]', e.name, e.code ?? '')
    return page(false, scrub(e.message), origin)
  }
}
