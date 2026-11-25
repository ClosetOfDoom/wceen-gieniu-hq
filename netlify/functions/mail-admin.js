// Netlify Function (Functions API v2): mail-admin — the API of the "Mail" tab (behind the shared password).
//
//   GET                                   → { configured, connected, invalid, email, connectedAt }
//   POST { action: 'connect-url' }        → { url }   the Google consent URL (one-time "Connect Google")
//   POST { action: 'triage' }             → counts + the messages that wait for Filip, each with a suggested template and buyer check
//   POST { action: 'preview', templateId, code? }
//   POST { action: 'send', messageId, templateId, code?, confirmUnverified? }   the ONLY way a reply leaves; see mailTriage.js
//   POST { action: 'skip', messageId }    label STANLEY/skipped
//   POST { action: 'disconnect' }         revoke + delete the stored tokens
// Nothing here deletes or trashes mail. Addresses and subjects are never logged.

import { withStanleyAuthV2, appOrigin } from '../shared/auth.js'
import { googleConfigFromEnv, redirectUriFor, buildAuthUrl, signState } from '../shared/googleAuth.js'
import { realMailDeps } from '../shared/mailDeps.js'
import { triageInbox, previewReply, sendApprovedReply, skipMessage, MailPolicyError } from '../shared/mailTriage.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const scrub = (s) => String(s).replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').slice(0, 200)

export default withStanleyAuthV2(async (req) => {
  const env = process.env
  let cfg = null
  try { cfg = googleConfigFromEnv(env) } catch { /* reported as configured: false */ }
  const deps = realMailDeps(env)
  try {
    if (req.method === 'GET') return json(200, { configured: Boolean(cfg), ...(await deps.session.status()) })
    if (req.method !== 'POST') return json(405, { error: 'GET or POST' })
    let body
    try { body = JSON.parse((await req.text()) || '{}') } catch { return json(400, { error: 'the body is not JSON' }) }
    const action = String(body.action ?? '')

    if (action === 'connect-url') {
      if (!cfg) return json(503, { error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Netlify' })
      const redirectUri = redirectUriFor(appOrigin(env))
      const state = signState(env.STANLEY_ACCESS_TOKEN)
      return json(200, { url: buildAuthUrl({ clientId: cfg.clientId, redirectUri, state }), redirectUri })
    }
    if (action === 'disconnect') { await deps.session.disconnect(); return json(200, { ok: true }) }
    if (action === 'preview') return json(200, previewReply(String(body.templateId ?? ''), body.code))

    const st = await deps.session.status()
    if (!st.connected || st.invalid) return json(409, { error: st.invalid ? 'Google access was revoked: connect again' : 'Google is not connected', connected: false })

    if (action === 'triage') return json(200, await triageInbox({ gmail: deps.gmail, findOrders: deps.findOrders }))
    if (action === 'skip') return json(200, await skipMessage({ gmail: deps.gmail, messageId: body.messageId }))
    if (action === 'send') {
      const r = await sendApprovedReply({
        gmail: deps.gmail, kv: deps.kv, findOrders: deps.findOrders,
        messageId: body.messageId, templateId: String(body.templateId ?? ''), code: body.code, confirmUnverified: body.confirmUnverified === true,
      })
      return json(200, r)
    }
    return json(400, { error: 'unknown action' })
  } catch (e) {
    if (e instanceof MailPolicyError) return json(e.code === 'bad_request' ? 400 : 422, { error: e.message, code: e.code })
    console.error('[mail-admin]', e.name, e.code ?? '', scrub(e.message))
    return json(502, { error: scrub(e.message), code: e.code ?? 'error' })
  }
})
