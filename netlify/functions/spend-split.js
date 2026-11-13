// Netlify Function: spend-split
//
// Ad spend per Meta day, split into the part that may be a denominator for Wix
// orders (BLENDED) and the part that may not (EXCLUDED — Cogni).
//
//   GET /.netlify/functions/spend-split?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// WHY AN ENDPOINT AT ALL
// ---------------------------------------------------------------------------
// The browser reads its daily rows from v_daily_wix_meta_performance, which
// returns ONE meta_spend per day: the sum of everything Meta spent. That figure
// cannot be split after the fact, and meta_ads_daily — where the campaign names
// live — is closed to the anon key. So the split has to be made where the
// service key is, by the one function that knows the rule (splitAdSpend), and
// handed to the browser as numbers. The browser never decides what Cogni is.
//
// Read-only. Writes nothing.

import { readTable } from '../shared/supabaseRead.js'
import { splitAdSpendByDay, splitAdSpend } from '../shared/adSpend.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'Server env missing' }) }
  }

  const qp = event.queryStringParameters || {}
  const { from, to } = qp
  if (!DATE.test(from ?? '') || !DATE.test(to ?? '')) {
    return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'from and to must be YYYY-MM-DD' }) }
  }

  try {
    const rows = await readTable(supabaseUrl, serviceKey, 'meta_ads_daily', {
      select:  'date,campaign_name,ad_name,spend',
      order:   'date.asc,ad_id.asc,campaign_id.asc',
      filters: { date: [`gte.${from}`, `lte.${to}`] },
    })
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        from, to,
        rowsRead: rows.length,
        days: splitAdSpendByDay(rows),
        range: splitAdSpend(rows),
      }),
    }
  } catch (e) {
    // The caller must be able to tell "no Cogni" from "could not look".
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
    }
  }
}
