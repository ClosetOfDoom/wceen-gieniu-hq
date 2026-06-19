// Netlify Function: profit-data
// Estimated operational profit for today (Warsaw timezone).
// Uses service role key — bypasses RLS.
// Methodology: contribution margin per product - ad spend today.
// See docs/profit_metrics.md for full explanation.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Margin rules (matches src/services/productMargins.ts) ────────────────────

const MARGIN_RULES = [
  { amount: 119, productKey: 'memory_pack',   displayName: 'Pakiet pamięciowy', contributionMargin: 70  },
  { amount: 114, productKey: 'language_pack',  displayName: 'Pakiet językowy',   contributionMargin: 40  },
  { amount: 549, productKey: 'jsu_course',     displayName: 'Kurs Jak się uczyć', contributionMargin: null },
  { amount: 347, productKey: 'jzk_ai',         displayName: 'Językozak AI',       contributionMargin: null },
]

function getMarginRule(amount) {
  return MARGIN_RULES.find(r => r.amount === amount) ?? null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function warsawToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

function warsawDayBoundaries(dateStr) {
  // Returns ISO UTC start/end for the full Warsaw calendar day
  const start = new Date(`${dateStr}T00:00:00+02:00`)
  const end   = new Date(`${dateStr}T23:59:59+02:00`)
  // Try CET (UTC+1) fallback if offset is wrong; simpler: just do date prefix filter
  return { start: start.toISOString(), end: end.toISOString() }
}

async function supabaseGet(supabaseUrl, serviceKey, table, params = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) {
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

function extractOrderDate(row) {
  return (
    row.order_created_at ?? row.order_date ?? row.created_at ??
    row.date ?? row.created ?? ''
  ).slice(0, 10)
}

function extractAmount(row) {
  const candidates = [row.amount, row.total, row.price, row.revenue, row.order_total, row.price_total, row.total_price]
  for (const c of candidates) {
    const n = Number(c)
    if (!isNaN(n) && n > 0) return n
  }
  return 0
}

function extractProductNameRaw(row) {
  return row.product_name_raw ?? row.product_name ?? row.item_name ?? row.product_title ?? null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: `Server env missing: ${missing}` }),
    }
  }

  const today = warsawToday()
  const errors = []

  // ── Fetch today's orders (service role) ───────────────────────────────────

  let allOrders = []
  let usedOrdersTable = 'none'

  for (const tableName of ['orders', 'wix_orders']) {
    try {
      const data = await supabaseGet(supabaseUrl, serviceKey, tableName, {
        select: '*',
        limit:  '500',
      })
      allOrders = data
      usedOrdersTable = tableName
      break
    } catch (e) {
      errors.push(`orders fetch (${tableName}): ${String(e?.message ?? e)}`)
    }
  }

  // Filter to today (Warsaw)
  const todayOrders = allOrders.filter(row => extractOrderDate(row) === today)

  // ── Classify and compute margins ──────────────────────────────────────────

  const productAccum = {}  // productKey → { displayName, orders, revenue, margin, marginTotal }
  let knownMargin       = 0
  let unknownRevenue    = 0
  let unknownOrdersCount = 0
  let totalRevenue      = 0
  const unmappedOrders  = []

  for (const row of todayOrders) {
    const amount = extractAmount(row)
    totalRevenue += amount
    const rule = getMarginRule(amount)

    if (!rule) {
      // Amount doesn't match any known product
      unknownRevenue     += amount
      unknownOrdersCount++
      unmappedOrders.push({
        amount,
        product_name_raw: extractProductNameRaw(row) ?? '—',
        order_date:       extractOrderDate(row),
        note:             'no margin rule for this price',
      })
      continue
    }

    if (rule.contributionMargin !== null) {
      knownMargin += rule.contributionMargin
    } else {
      // Product is known but margin is not configured
      unknownRevenue     += amount
      unknownOrdersCount++
      unmappedOrders.push({
        amount,
        product_name_raw: extractProductNameRaw(row) ?? '—',
        order_date:       extractOrderDate(row),
        productKey:       rule.productKey,
        note:             'margin not yet configured for this product',
      })
    }

    if (!productAccum[rule.productKey]) {
      productAccum[rule.productKey] = {
        productKey:          rule.productKey,
        displayName:         rule.displayName,
        orders:              0,
        revenue:             0,
        contributionMargin:  rule.contributionMargin,
        marginTotal:         0,
      }
    }
    productAccum[rule.productKey].orders++
    productAccum[rule.productKey].revenue += amount
    if (rule.contributionMargin !== null) {
      productAccum[rule.productKey].marginTotal += rule.contributionMargin
    }
  }

  const productBreakdown = Object.values(productAccum)

  // ── Fetch today's ad spend ────────────────────────────────────────────────

  let adSpend       = 0
  let adSpendSource = 'none'

  // Prefer v_daily_wix_meta_performance (same source as Command Center)
  try {
    const perfRows = await supabaseGet(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
      select: 'date,meta_spend',
      'date': `eq.${today}`,
      limit:  '1',
    })
    if (perfRows.length > 0 && perfRows[0].meta_spend != null) {
      adSpend       = Number(perfRows[0].meta_spend) || 0
      adSpendSource = 'v_daily_wix_meta_performance'
    }
  } catch (e) {
    errors.push(`v_daily_wix_meta_performance: ${String(e?.message ?? e)}`)
  }

  // Fallback to meta_ads_daily sum if aggregated view had no data
  if (adSpendSource === 'none') {
    try {
      const adsRows = await supabaseGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
        select: 'spend',
        date:   `eq.${today}`,
        limit:  '200',
      })
      if (adsRows.length > 0) {
        adSpend       = adsRows.reduce((s, r) => s + (Number(r.spend) || 0), 0)
        adSpendSource = 'meta_ads_daily'
      }
    } catch (e) {
      errors.push(`meta_ads_daily: ${String(e?.message ?? e)}`)
    }
  }

  // ── Compute profit ────────────────────────────────────────────────────────

  const marginBeforeAds         = knownMargin
  const estimatedProfitAfterAds = knownMargin - adSpend
  const ordersCount             = todayOrders.length
  const estimatedProfitPerOrder = ordersCount > 0 ? estimatedProfitAfterAds / ordersCount : 0

  return {
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type':  'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      ok:                    true,
      timestamp:             new Date().toISOString(),
      dateWarsaw:            today,
      ordersCount,
      revenue:               totalRevenue,
      adSpend,
      adSpendSource,
      knownMargin,
      unknownRevenue,
      unknownOrdersCount,
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      productBreakdown,
      unmappedOrders,
      sourceTable:           usedOrdersTable,
      errors:                errors.length > 0 ? errors : undefined,
    }),
  }
}
