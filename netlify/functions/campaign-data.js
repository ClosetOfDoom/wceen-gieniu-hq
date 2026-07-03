// Netlify Function: campaign-data
// Campaign rows backend using service role (bypasses RLS on meta_ads_daily).
// Also checks v_daily_wix_meta_performance so the frontend can detect when
// aggregate Meta spend exists but campaign-level rows are missing.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

async function supabaseGet(supabaseUrl, serviceKey, table, filters = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item)
    } else {
      url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} on ${table}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function tryGet(supabaseUrl, serviceKey, table, filters = {}) {
  try {
    const data = await supabaseGet(supabaseUrl, serviceKey, table, filters)
    return { ok: true, data, error: null }
  } catch (e) {
    return { ok: false, data: [], error: String(e?.message ?? e) }
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: `Server env missing: ${missing}` }),
    }
  }

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

  // ── Range mode: /campaign-data?from=YYYY-MM-DD&to=YYYY-MM-DD ───────────────
  // Aggregates meta_ads_daily per creative across the [from,to] window so the
  // Campaigns view can show today / yesterday / week / month. The header then
  // reflects the REAL dates present in the data (no date vs data mismatch).
  const qp = event.queryStringParameters || {}
  const from = qp.from
  const to   = qp.to
  if (from && to) {
    const rangeRes = await tryGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
      select: '*',
      date:   [`gte.${from}`, `lte.${to}`],
      order:  'date.desc',
      limit:  '3000',
    })
    const raw = rangeRes.data ?? []
    // Group per creative (campaign + ad) and sum the daily rows.
    const map = new Map()
    const dates = new Set()
    for (const r of raw) {
      if (r.date) dates.add(r.date)
      const key = `${r.campaign_id || ''}|${r.ad_name || r.campaign_name || ''}`
      const g = map.get(key) || {
        campaign_id: r.campaign_id ?? null,
        campaign_name: r.campaign_name ?? null,
        ad_name: r.ad_name ?? null,
        spend: 0, impressions: 0, clicks: 0, link_clicks: 0,
        meta_purchases: 0, meta_purchase_value: 0,
      }
      g.spend              += Number(r.spend) || 0
      g.impressions        += Number(r.impressions) || 0
      g.clicks             += Number(r.clicks) || 0
      g.link_clicks        += Number(r.link_clicks) || 0
      g.meta_purchases     += Number(r.meta_purchases ?? r.purchases) || 0
      g.meta_purchase_value += Number(r.meta_purchase_value) || 0
      map.set(key, g)
    }
    const datesPresent = [...dates].sort()
    const aggRows = [...map.values()]
      .map(g => ({ ...g, date: datesPresent[datesPresent.length - 1] ?? to }))
      .sort((a, b) => b.spend - a.spend)

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        rows: aggRows,
        usedDate: datesPresent[datesPresent.length - 1] ?? '',
        requestedDate: to,
        rangeFrom: from,
        rangeTo: to,
        datesPresent,
        rawRowCount: raw.length,
        sourceTable: 'meta_ads_daily',
        aggregateMetaSpendExists: aggRows.length > 0,
        aggregateLatestDate: datesPresent[datesPresent.length - 1] ?? null,
        aggregateSpendTotal: aggRows.reduce((s, g) => s + g.spend, 0),
        sourceMismatch: false,
        sourceMismatchExplanation: null,
        errors: { meta_ads_daily: rangeRes.error, v_daily_wix_meta_performance: null },
      }),
    }
  }

  // ── Fetch today's campaign rows from meta_ads_daily ───────────────────────

  const todayRes = await tryGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
    select: '*',
    date:   `eq.${today}`,
    order:  'spend.desc',
    limit:  '200',
  })

  let rows = todayRes.data ?? []
  let usedDate = rows.length > 0 ? today : ''
  let requestedDate = today
  let metaAdsError = todayRes.error

  // Fallback: find latest available date
  if (rows.length === 0) {
    const latestDateRes = await tryGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
      select: 'date',
      order:  'date.desc',
      limit:  '1',
    })

    if (latestDateRes.ok && latestDateRes.data.length > 0) {
      const latestDate = latestDateRes.data[0].date
      const latestRowsRes = await tryGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
        select: '*',
        date:   `eq.${latestDate}`,
        order:  'spend.desc',
        limit:  '200',
      })
      if (latestRowsRes.ok) {
        rows = latestRowsRes.data ?? []
        usedDate = latestDate
        metaAdsError = latestRowsRes.error
      }
    }
  }

  // ── Check v_daily_wix_meta_performance for aggregate spend ────────────────
  // This is the source used by Command Center's Ad Spend KPI card.

  const perfRes = await tryGet(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
    select: 'date,meta_spend',
    order:  'date.desc',
    limit:  '7',
  })

  let aggregateMetaSpendExists = false
  let aggregateLatestDate = null
  let aggregateSpendTotal = 0
  let aggregateSpendLatest = 0

  if (perfRes.ok && Array.isArray(perfRes.data)) {
    aggregateSpendTotal = perfRes.data.reduce((s, r) => s + (Number(r.meta_spend) || 0), 0)
    aggregateMetaSpendExists = aggregateSpendTotal > 0
    if (perfRes.data.length > 0) {
      aggregateLatestDate  = perfRes.data[0].date ?? null
      aggregateSpendLatest = Number(perfRes.data[0].meta_spend) || 0
    }
  }

  // ── Source mismatch detection ─────────────────────────────────────────────
  // Mismatch: Command Center shows spend but Campaigns has no rows.

  const sourceMismatch = aggregateMetaSpendExists && rows.length === 0

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok:           true,
      rows,
      usedDate,
      requestedDate,
      sourceTable:            'meta_ads_daily',
      aggregateMetaSpendExists,
      aggregateLatestDate,
      aggregateSpendTotal,
      aggregateSpendLatest,
      sourceMismatch,
      sourceMismatchExplanation: sourceMismatch
        ? `v_daily_wix_meta_performance has ${aggregateSpendTotal.toFixed(2)} PLN Meta spend (last 7 days), but meta_ads_daily has 0 campaign rows. The Meta webhook may write to a different table or the data has not been ingested at the campaign level.`
        : null,
      errors: {
        meta_ads_daily:                metaAdsError,
        v_daily_wix_meta_performance:  perfRes.error,
      },
    }),
  }
}
