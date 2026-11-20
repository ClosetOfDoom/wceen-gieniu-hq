// Netlify Function (Functions API v2): webinar-mail-health — PUBLIC, GET only, read only.
//
// Proof that the webinar mail machinery can read its state in production, without the shared password.
// Returns EXACTLY: { build, blobsRead: "ok"|"error", auto, pauza, kolejka: { wtorek, czwartek }, nastepnaWysylka,
//   alarmy: [codes of active alerts], ostatnieWpisy: [{ data, slot, status, test }] (max 5),
//   nadawcy: { wtorek, czwartek } (sender NAME per slot), aktualnyNadawca: the sender NAME in Wix now (null if unreadable) }.
// No template content, names or subjects, no campaign IDs, no e-mails, no secrets (healthSummary builds the whole body).
// Same store read as webinar-mail-run: createBlobStore() from webinarMailStore.js (getState, getLog, getLastRun, getRun).
// On the allow-list of public functions in scripts/assert-stanley-auth.mjs.

import { healthSummary } from '../shared/webinarMailAdmin.js'
import { createBlobStore } from '../shared/webinarMailStore.js'
import { createWixClient } from '../shared/webinarMailWix.js'
import { loadTemplates } from '../shared/webinarMailTemplates.js'
import { readBuildHash } from '../shared/buildInfo.js'
import { WEBINAR_MAIL_CONFIG } from '../shared/webinarMailConfig.js'

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

export default async function handler(req) {
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'tylko GET' }), { status: 405, headers: { ...headers, Allow: 'GET' } })
  let store = null
  try { store = createBlobStore() } catch (e) { console.error('[webinar-mail-health] store init failed:', String(e?.message ?? e).slice(0, 200)) }
  const unavailable = async () => { throw new Error('store unavailable') }
  const failing = { getState: unavailable, getLog: unavailable, getLastRun: unavailable, getRun: unavailable }
  let wix = null
  try { wix = createWixClient({ apiKey: process.env.WIX_API_KEY, siteId: process.env.WIX_SITE_ID }) } catch (e) { console.error('[webinar-mail-health] wix init failed:', String(e?.message ?? e).slice(0, 200)) }
  const deps = { store: store ?? failing, wix, loadTemplates: (slot) => loadTemplates(WEBINAR_MAIL_CONFIG.slots[slot].dir) }
  const body = await healthSummary({ deps, build: await readBuildHash() })
  return new Response(JSON.stringify(body), { status: 200, headers })
}
