// Netlify Function: data-health
// Backend data source diagnostic using service role (bypasses RLS).
// Checks all operational Supabase tables so the UI can show true data state
// and detect source mismatches (e.g. v_daily_wix_meta_performance has spend
// but meta_ads_daily is empty or inaccessible via anon key).

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

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

async function supabaseCount(supabaseUrl, serviceKey, table) {
  // Uses Prefer: count=exact with HEAD request — returns count from Content-Range header
  const url = `${supabaseUrl}/rest/v1/${table}?select=*`
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':        serviceKey,
        'Prefer':        'count=exact',
      },
    })
    if (!res.ok) return { count: null, error: `HTTP ${res.status}` }
    const range = res.headers.get('content-range') ?? ''
    const total = parseInt((range.split('/')[1] ?? '').trim(), 10)
    return { count: isNaN(total) ? null : total, error: null }
  } catch (e) {
    return { count: null, error: String(e?.message ?? e) }
  }
}

async function tryGet(supabaseUrl, serviceKey, table, filters = {}) {
  try {
    const data = await supabaseGet(supabaseUrl, serviceKey, table, filters)
    return { ok: true, data, error: null }
  } catch (e) {
    return { ok: false, data: [], error: String(e?.message ?? e) }
  }
}

// ── Warsaw helpers ────────────────────────────────────────────────────────────

function warsawToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

function warsawWeekStart() {
  const today = warsawToday()
  const d = new Date(today + 'T12:00:00Z')
  const dow = d.getUTCDay()
  const diff = (dow + 6) % 7  // days since Monday
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - diff)
  return monday.toISOString().slice(0, 10)
}

function extractOrderDate(row) {
  return (
    row.order_created_at ?? row.order_date ?? row.created_at ??
    row.date ?? row.created ?? ''
  ).slice(0, 10)
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***'
  const [local, domain] = email.split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

// ── Handler ───────────────────────────────────────────────────────────────────

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

  const today     = warsawToday()
  const weekStart = warsawWeekStart()

  // ── 1. orders table ───────────────────────────────────────────────────────────

  const ordersCountRes = await supabaseCount(supabaseUrl, serviceKey, 'orders')
  const ordersLatestRes = await tryGet(supabaseUrl, serviceKey, 'orders', {
    select: 'id,external_order_id,buyer_email,email,amount,total,price,product_name_raw,order_created_at,created_at,order_date',
    order:  'order_created_at.desc',
    limit:  '10',
  })

  let ordersLatest5 = []
  let ordersLatestDate = null
  let ordersTodayCount = 0
  let ordersTodayRevenue = 0
  let ordersWeekCount = 0
  let ordersWeekRevenue = 0

  if (ordersLatestRes.ok && Array.isArray(ordersLatestRes.data)) {
    ordersLatest5 = ordersLatestRes.data.slice(0, 5).map(r => ({
      external_order_id: r.external_order_id ?? r.id ?? '—',
      email_masked:      maskEmail(r.buyer_email ?? r.email ?? ''),
      product_name_raw:  r.product_name_raw ?? '—',
      amount:            Number(r.amount ?? r.total ?? r.price ?? 0),
      order_date:        extractOrderDate(r),
    }))
    if (ordersLatestRes.data.length > 0) {
      ordersLatestDate = extractOrderDate(ordersLatestRes.data[0]) || null
    }
  }

  // Fetch more orders to compute today/week counts
  const allOrdersRes = await tryGet(supabaseUrl, serviceKey, 'orders', {
    select: 'amount,total,price,order_created_at,created_at,order_date',
    limit:  '500',
  })
  if (allOrdersRes.ok && Array.isArray(allOrdersRes.data)) {
    for (const r of allOrdersRes.data) {
      const d   = extractOrderDate(r)
      const amt = Number(r.amount ?? r.total ?? r.price ?? 0)
      if (d === today) {
        ordersTodayCount++
        ordersTodayRevenue += amt
      }
      if (d >= weekStart) {
        ordersWeekCount++
        ordersWeekRevenue += amt
      }
    }
  }

  const ordersSection = {
    count:            ordersCountRes.count,
    count_error:      ordersCountRes.error,
    latest_order_date: ordersLatestDate,
    today_count:      ordersTodayCount,
    today_revenue:    ordersTodayRevenue,
    week_count:       ordersWeekCount,
    week_revenue:     ordersWeekRevenue,
    latest_5:         ordersLatest5,
    error:            ordersLatestRes.error,
  }

  // ── 2. webinar_sessions ───────────────────────────────────────────────────────

  const sessCountRes = await supabaseCount(supabaseUrl, serviceKey, 'webinar_sessions')
  const sessLatestRes = await tryGet(supabaseUrl, serviceKey, 'webinar_sessions', {
    select: 'id,session_name,scheduled_at',
    order:  'scheduled_at.desc',
    limit:  '1',
  })
  const sessLatest = sessLatestRes.data?.[0] ?? null

  const webinarSection = {
    sessions_count:     sessCountRes.count,
    sessions_error:     sessCountRes.error,
    latest_session_at:  sessLatest?.scheduled_at ?? null,
    latest_session_name: sessLatest?.session_name ?? null,
  }

  // ── 3. webinar_participants ───────────────────────────────────────────────────

  const partCountRes = await supabaseCount(supabaseUrl, serviceKey, 'webinar_participants')
  const partLatestRes = await tryGet(supabaseUrl, serviceKey, 'webinar_participants', {
    select: 'id,created_at',
    order:  'created_at.desc',
    limit:  '1',
  })
  const partLatest = partLatestRes.data?.[0] ?? null

  webinarSection.participants_count    = partCountRes.count
  webinarSection.participants_error    = partCountRes.error
  webinarSection.latest_participant_at = partLatest?.created_at ?? null

  // ── 4. meta_ads_daily ────────────────────────────────────────────────────────

  const metaCountRes  = await supabaseCount(supabaseUrl, serviceKey, 'meta_ads_daily')
  const metaLatestRes = await tryGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
    select: 'date,campaign_name,spend,inserted_at',
    order:  'date.desc',
    limit:  '10',
  })

  let metaLatestDate    = null
  let metaLatestInserted = null
  let metaCampaignNames = []

  if (metaLatestRes.ok && Array.isArray(metaLatestRes.data) && metaLatestRes.data.length > 0) {
    metaLatestDate     = metaLatestRes.data[0].date ?? null
    metaLatestInserted = metaLatestRes.data[0].inserted_at ?? null
    metaCampaignNames  = [...new Set(metaLatestRes.data.map(r => r.campaign_name).filter(Boolean))]
  }

  const metaAdsSection = {
    count:            metaCountRes.count,
    count_error:      metaCountRes.error,
    latest_date:      metaLatestDate,
    latest_inserted_at: metaLatestInserted,
    campaign_names:   metaCampaignNames,
    error:            metaLatestRes.error,
  }

  // ── 5. v_daily_wix_meta_performance (source used by Command Center) ───────────

  const perfCountRes  = await supabaseCount(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance')
  const perfLatestRes = await tryGet(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
    select: 'date,meta_spend,wix_orders,wix_revenue',
    order:  'date.desc',
    limit:  '7',
  })

  let perfLatestDate  = null
  let perfTotalSpend  = 0
  let perfHasAnySpend = false

  if (perfLatestRes.ok && Array.isArray(perfLatestRes.data) && perfLatestRes.data.length > 0) {
    perfLatestDate  = perfLatestRes.data[0].date ?? null
    perfTotalSpend  = perfLatestRes.data.reduce((s, r) => s + (Number(r.meta_spend) || 0), 0)
    perfHasAnySpend = perfTotalSpend > 0
  }

  const commandCenterSource = {
    table:                    'v_daily_wix_meta_performance',
    count:                    perfCountRes.count,
    latest_date:              perfLatestDate,
    has_meta_spend:           perfHasAnySpend,
    total_spend_7d:           perfTotalSpend,
    error:                    perfLatestRes.error,
  }

  // ── 6. Source mismatch detection ──────────────────────────────────────────────

  const campaignsSource = {
    table:           'meta_ads_daily',
    count:           metaCountRes.count,
    latest_date:     metaLatestDate,
  }

  const sourceMismatch =
    perfHasAnySpend &&
    (metaCountRes.count === 0 || metaCountRes.count === null)

  const metaSection = {
    meta_ads_daily:                  metaAdsSection,
    command_center_source:           commandCenterSource,
    campaigns_source:                campaignsSource,
    source_mismatch:                 sourceMismatch,
    source_mismatch_explanation:
      sourceMismatch
        ? `v_daily_wix_meta_performance has Meta spend (${perfTotalSpend.toFixed(2)} PLN over last 7 days) but meta_ads_daily has ${metaCountRes.count ?? 0} rows. Campaigns page shows "no data" while Command Center shows spend.`
        : null,
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok:        true,
      timestamp: new Date().toISOString(),
      today_warsaw: today,
      week_start:   weekStart,
      orders:    ordersSection,
      webinars:  webinarSection,
      meta:      metaSection,
    }),
  }
}
