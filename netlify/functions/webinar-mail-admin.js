// Netlify Function (Functions API v2): webinar-mail-admin
//
// The API of the "Maile webinarowe" tab (behind the shared password, like every function).
//   GET                               → status: AUTO/PAUZA, queues, send log with CTR, alerts, last run
//   POST { action: 'set-state', auto?, pause? }
//   POST { action: 'ack' }                           acknowledge the last failed run (clears the red alert)
//   POST { action: 'set-registrations', key, value } manual ClickMeeting registrations count
//   POST { action: 'dry-run', slot }                 the whole run for the next wake-up, without publishing
//   POST { action: 'send-test', slot, variant? }     "Wyślij test": the same Create + Publish as production, sendAt now+31 min,
//                                                    to exactly ONE contact (testContactId); any other audience is rejected
// Nothing here can publish a campaign to the audience (contacts-all): only webinar-mail-run does that.
//
// v2 (export default, Request → Response) like webinar-mail-run: Netlify Blobs with strong consistency needs the v2
// runtime environment (the old v1 handler failed in production with "uncachedEdgeURL" not configured).
// The store comes from createBlobStore() in webinarMailStore.js, the one access path to Blobs.

import { withStanleyAuthV2 } from '../shared/auth.js'
import { adminStatus, adminAction } from '../shared/webinarMailAdmin.js'
import { createWixClient, checkUrl } from '../shared/webinarMailWix.js'
import { createBlobStore } from '../shared/webinarMailStore.js'
import { loadTemplates } from '../shared/webinarMailTemplates.js'
import { WEBINAR_MAIL_CONFIG } from '../shared/webinarMailConfig.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export default withStanleyAuthV2(async (req) => {
  let wix
  try {
    wix = createWixClient({ apiKey: process.env.WIX_API_KEY, siteId: process.env.WIX_SITE_ID })
  } catch (e) {
    return json(503, { error: e.message })
  }
  try {
    const deps = { store: createBlobStore(), wix, checkUrl, loadTemplates: (slot) => loadTemplates(WEBINAR_MAIL_CONFIG.slots[slot].dir) }
    if (req.method === 'GET') return json(200, await adminStatus({ deps }))
    if (req.method !== 'POST') return json(405, { error: 'GET albo POST' })
    let body
    try { body = JSON.parse((await req.text()) || '{}') } catch { return json(400, { error: 'ciało nie jest JSON-em' }) }
    const result = await adminAction({ action: String(body.action ?? ''), body, deps })
    return result.ok ? json(200, result) : json(400, result)
  } catch (e) {
    console.error('[webinar-mail-admin]', e.message)
    return json(500, { error: String(e.message).slice(0, 300) })
  }
})
