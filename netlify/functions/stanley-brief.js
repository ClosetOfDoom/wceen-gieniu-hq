// Netlify Function (Functions API v2): stanley-brief — read the daily brief (behind the shared password).
//
//   GET                       → the newest saved brief (404 when none yet)
//   GET ?date=YYYY-MM-DD      → that day's brief;  GET ?list=1 → { dates } (the 14 kept)
//   POST { action: 'dry-run' } → a brief computed now from real data; NOT saved, no notification

import { withStanleyAuthV2 } from '../shared/auth.js'
import { latestBrief, listBriefDates, runDailyBrief } from '../shared/dailyBrief.js'
import { realBriefDeps } from '../shared/briefDeps.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export default withStanleyAuthV2(async (req) => {
  try {
    const { deps, llm } = await realBriefDeps()
    if (req.method === 'GET') {
      const q = new URL(req.url).searchParams
      if (q.get('list') === '1') return json(200, { dates: await listBriefDates(deps.kv) })
      const date = q.get('date')
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: 'date: RRRR-MM-DD' })
      const brief = date ? await deps.kv.getJSON(`brief/${date}`) : await latestBrief(deps.kv)
      return brief ? json(200, brief) : json(404, { error: date ? `brak briefu z ${date}` : 'brak zapisanego briefu' })
    }
    if (req.method !== 'POST') return json(405, { error: 'GET albo POST' })
    let body
    try { body = JSON.parse((await req.text()) || '{}') } catch { return json(400, { error: 'ciało nie jest JSON-em' }) }
    if (body.action !== 'dry-run') return json(400, { error: 'akcja: dry-run' })
    const out = await runDailyBrief({ now: new Date(), deps, llm, dryRun: true, force: true })
    return json(200, out.brief)
  } catch (e) {
    console.error('[stanley-brief]', String(e?.message ?? e).slice(0, 300))
    return json(500, { error: String(e?.message ?? e).slice(0, 300) })
  }
})
