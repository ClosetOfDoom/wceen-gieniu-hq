// Netlify Function (Functions API v2): stanley-push — web push for "Brief gotowy" (behind the shared password).
//
//   GET                                        → { publicKey } (VAPID; the pair is generated on first use and kept in Blobs)
//   POST { action: 'subscribe', subscription } → stores the browser's PushSubscription
//   POST { action: 'test' }                    → sends "Brief gotowy" to every subscription now (to check the phone)

import { withStanleyAuthV2 } from '../shared/auth.js'
import { createKvStore } from '../shared/webinarMailStore.js'
import { getVapid, notifyBriefReady, saveSubscription } from '../shared/stanleyPush.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export default withStanleyAuthV2(async (req) => {
  try {
    const kv = createKvStore()
    if (req.method === 'GET') return json(200, { publicKey: (await getVapid(kv)).publicKey })
    if (req.method !== 'POST') return json(405, { error: 'GET albo POST' })
    let body
    try { body = JSON.parse((await req.text()) || '{}') } catch { return json(400, { error: 'ciało nie jest JSON-em' }) }
    if (body.action === 'subscribe') {
      try { await saveSubscription(kv, body.subscription) } catch (e) { return json(400, { error: e.message }) }
      return json(200, { ok: true })
    }
    if (body.action === 'test') return json(200, await notifyBriefReady(kv, null))
    return json(400, { error: 'akcja: subscribe albo test' })
  } catch (e) {
    console.error('[stanley-push]', String(e?.message ?? e).slice(0, 300))
    return json(500, { error: String(e?.message ?? e).slice(0, 300) })
  }
})
