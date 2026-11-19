// Netlify Scheduled Function: webinar-mail-run
//
// Wakes at 06:00 Europe/Warsaw on Tuesday (language webinar) and Thursday (memory webinar).
// The cron has TWO UTC hours (04 and 05): in summer (CEST) 06:00 Warsaw = 04:00 UTC, in winter
// (CET) = 05:00 UTC. The run at the wrong hour exits at once (reason "not-wake-hour").
//
// With AUTO ON and PAUZA OFF it builds a Wix campaign from the next unsent template of the slot
// and publishes it with sendAt 07:00 to all contacts. Every decision is in
// netlify/shared/webinarMail.js (runWebinarMail); this file only wires the real Wix, Blobs and clock.
//
// WEBINAR_MAIL_DRY_RUN=1 turns the whole run into a dry run (no claim, no campaign, no publish).

import { runWebinarMail } from '../shared/webinarMail.js'
import { createWixClient, checkUrl } from '../shared/webinarMailWix.js'
import { createBlobStore } from '../shared/webinarMailStore.js'
import { loadTemplates } from '../shared/webinarMailTemplates.js'
import { WEBINAR_MAIL_CONFIG } from '../shared/webinarMailConfig.js'

/** A Wix client whose every call fails with the same clear message (missing env), so the run records it. */
function unavailableWix(message) {
  const fail = async () => { throw new Error(message) }
  return { accountDetails: fail, listRecentCampaigns: fail, previewCampaign: fail, createCampaign: fail, publishCampaign: fail, sendTest: fail, deleteCampaign: fail, campaignStats: fail }
}

export default async function handler() {
  const now = new Date()
  const dryRun = process.env.WEBINAR_MAIL_DRY_RUN === '1'
  let wix
  try {
    wix = createWixClient({ apiKey: process.env.WIX_API_KEY, siteId: process.env.WIX_SITE_ID })
  } catch (e) {
    wix = unavailableWix(e.message)
  }
  const deps = {
    store: createBlobStore(),
    wix,
    checkUrl,
    loadTemplates: (slot) => loadTemplates(WEBINAR_MAIL_CONFIG.slots[slot].dir),
  }
  const outcome = await runWebinarMail({ now, deps, dryRun })
  // One log line per run; never the key, never the HTML.
  console.log('[webinar-mail-run]', JSON.stringify({ status: outcome.status, reason: outcome.reason, key: outcome.key, dryRun, campaignId: outcome.campaignId, detail: outcome.detail }))
  return new Response(JSON.stringify({ status: outcome.status, reason: outcome.reason, key: outcome.key }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// Must stay a literal: Netlify reads it from the source. A test asserts it equals WEBINAR_MAIL_CONFIG.cron.
export const config = { schedule: '0 4,5 * * 2,4' }
