// Netlify Function: webinar-mail-admin
//
// The API of the "Maile webinarowe" tab (behind the shared password, like every function).
//   GET                               → status: AUTO/PAUZA, queues, send log with CTR, alerts, last run
//   POST { action: 'set-state', auto?, pause? }
//   POST { action: 'ack' }                           acknowledge the last failed run (clears the red alert)
//   POST { action: 'set-registrations', key, value } manual ClickMeeting registrations count
//   POST { action: 'dry-run', slot }                 the whole run for the next wake-up, without publishing
//   POST { action: 'send-test', slot }               Send Test Email of the next template to the test address
// Nothing here can publish a campaign to the audience: only webinar-mail-run does that.

import { connectLambda } from '@netlify/blobs'
import { withStanleyAuth } from '../shared/auth.js'
import { adminStatus, adminAction } from '../shared/webinarMailAdmin.js'
import { createWixClient, checkUrl } from '../shared/webinarMailWix.js'
import { createBlobStore } from '../shared/webinarMailStore.js'
import { loadTemplates } from '../shared/webinarMailTemplates.js'
import { WEBINAR_MAIL_CONFIG } from '../shared/webinarMailConfig.js'

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) })

export const handler = withStanleyAuth(async (event) => {
  connectLambda(event)
  let wix
  try {
    wix = createWixClient({ apiKey: process.env.WIX_API_KEY, siteId: process.env.WIX_SITE_ID })
  } catch (e) {
    return json(503, { error: e.message })
  }
  const deps = { store: createBlobStore(), wix, checkUrl, loadTemplates: (slot) => loadTemplates(WEBINAR_MAIL_CONFIG.slots[slot].dir) }
  try {
    if (event.httpMethod === 'GET') return json(200, await adminStatus({ deps }))
    if (event.httpMethod !== 'POST') return json(405, { error: 'GET albo POST' })
    let body
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'ciało nie jest JSON-em' }) }
    const result = await adminAction({ action: String(body.action ?? ''), body, deps })
    return result.ok ? json(200, result) : json(400, result)
  } catch (e) {
    console.error('[webinar-mail-admin]', e.message)
    return json(500, { error: String(e.message).slice(0, 300) })
  }
})
