// Netlify Scheduled Function: daily-brief — the 09:00 brief (Europe/Warsaw), every day.
//
// The cron has TWO UTC hours (07 and 08): 09:00 Warsaw is 07:00 UTC in summer (CEST) and 08:00 UTC in winter (CET);
// the run at the other hour exits at once (isBriefHour), like webinar-mail-run. Numbers are computed by
// netlify/shared/dailyBrief.js; the model only writes the guarded introduction. The brief is saved in Blobs (14 newest)
// and read by stanley-brief (behind the password) and the "Brief dnia" card on HOME.

import { runDailyBrief } from '../shared/dailyBrief.js'
import { realBriefDeps } from '../shared/briefDeps.js'

export default async function handler() {
  const now = new Date()
  const { deps, llm } = await realBriefDeps()
  const outcome = await runDailyBrief({ now, deps, llm })
  console.log('[daily-brief]', JSON.stringify({ status: outcome.status, reason: outcome.reason, date: outcome.brief?.date, gaps: outcome.brief?.gaps?.length, llm: outcome.brief?.llm, notified: outcome.notified }))
  return new Response(JSON.stringify({ status: outcome.status, reason: outcome.reason ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

// Must stay a literal: Netlify reads it from the source. A test asserts it equals BRIEF_CONFIG.cron.
export const config = { schedule: '0 7,8 * * *' }
