// Netlify Function: profit-data
// Estimated operational profit for a Warsaw date range (default: today).
// Uses service role key — bypasses RLS.
// Methodology: contribution margin per product − ad spend, over the range.
// See docs/profit_metrics.md for full explanation.
//
// Every price, margin, scope and classification rule comes from
// ./productCatalog.js. This file computes and reports; it never defines a number.
//
// Query params (all optional):
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  → aggregate the inclusive Warsaw range
//   ?date=YYYY-MM-DD                → a single day (shortcut for from=to=date)
//   ?debug=1                        → also return every classified order

import {
  PRODUCTS,
  aggregateOrders,
  classifyOrder,
  fetchOrdersInRange,
  maskEmail,
  warsawToday,
} from './productCatalog.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

async function supabaseGet(supabaseUrl, serviceKey, table, params = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, item) }
    else { url.searchParams.set(k, String(v)) }
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

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ')
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ ok: false, error: `Server env missing: ${missing}` }) }
  }

  const qp = event.queryStringParameters || {}
  const today = warsawToday()
  const from  = qp.from || qp.date || today
  const to    = qp.to   || qp.date || from
  const debug = qp.debug === '1'
  const errors = []

  // ── Fetch order rows for the range (ordered + paged — see productCatalog.js) ─
  let rangeRows = []
  let usedOrdersTable = 'none'
  for (const tableName of ['orders', 'wix_orders']) {
    try {
      rangeRows = await fetchOrdersInRange(supabaseUrl, serviceKey, tableName, from, to)
      usedOrdersTable = tableName
      break
    } catch (e) {
      errors.push(`orders fetch (${tableName}): ${String(e?.message ?? e)}`)
    }
  }

  // Rows → orders. Line items are grouped by order id and the shipping line is
  // dropped from the classification, so a 99 PLN product + 20 PLN shipping is
  // classified as one 119 PLN Pakiet Pamięciowy, not as two unknown lines.
  const orders = aggregateOrders(rangeRows)

  // ── Classify and accumulate ───────────────────────────────────────────────
  const productAccum = {}
  const scopeAccum   = {}
  let knownMargin = 0, totalRevenue = 0
  let unknownRevenue = 0, unknownOrdersCount = 0             // UNMAPPED
  let unknownMarginRevenue = 0, unknownMarginOrdersCount = 0 // product known, margin null
  let ambiguousRevenue = 0, ambiguousOrdersCount = 0
  let ambiguousMinMargin = 0
  const unmappedOrders = []
  const unknownMarginOrders = []
  const ambiguousOrders = []
  const conflicts = []
  const debugOrders = []

  for (const order of orders) {
    totalRevenue += order.revenue
    const d = classifyOrder(order)
    const dbgBase = {
      order_id:         order.orderId,
      email_masked:     maskEmail(order.email),
      amount:           order.revenue,
      product_amount:   order.productAmount,
      shipping_amount:  order.shippingAmount,
      line_count:       order.lineCount,
      product_name_raw: order.productNameRaw ?? '—',
      order_date:       order.orderDate,
    }

    if (d.conflict) {
      conflicts.push({
        ...dbgBase,
        price_product: PRODUCTS[d.conflict.priceProduct].displayName,
        price_amount:  d.conflict.priceAmount,
        name_product:  PRODUCTS[d.conflict.nameProduct]?.displayName ?? d.conflict.nameProduct,
      })
    }

    const dbg = (extra) => {
      if (debug) debugOrders.push({ ...dbgBase, bucket: d.bucket, product: d.productKey, scope: d.scope, matched_by: d.matchedBy, failed_field: d.failedField, ...extra })
    }

    if (d.bucket === 'UNMAPPED') {
      unknownRevenue += order.revenue
      unknownOrdersCount++
      unmappedOrders.push({ ...dbgBase, failed_field: d.failedField })
      dbg({ qty: null, margin: 0 })
      continue
    }

    if (d.bucket === 'UNKNOWN_MARGIN') {
      unknownMarginRevenue += order.revenue
      unknownMarginOrdersCount++
      unknownMarginOrders.push({ ...dbgBase, product: PRODUCTS[d.productKey].displayName, failed_field: d.failedField })
      dbg({ qty: d.qty, margin: 0 })
      continue
    }

    if (d.bucket === 'AMBIGUOUS') {
      ambiguousRevenue += order.revenue
      ambiguousOrdersCount++
      ambiguousMinMargin += d.minMargin
      ambiguousOrders.push({ ...dbgBase, product: PRODUCTS[d.productKey].displayName, minMargin: d.minMargin, failed_field: d.failedField })
      dbg({ qty: null, margin: 0, minMargin: d.minMargin })
      continue
    }

    // MAPPED
    knownMargin += d.margin
    if (!productAccum[d.productKey]) {
      const p = PRODUCTS[d.productKey]
      productAccum[d.productKey] = {
        productKey: d.productKey, displayName: p.displayName, scope: p.scope,
        orders: 0, units: 0, revenue: 0,
        contributionMargin: p.contributionMargin, marginTotal: 0,
      }
    }
    const acc = productAccum[d.productKey]
    acc.orders++
    acc.units   += d.qty
    acc.revenue += order.revenue
    acc.marginTotal += d.margin

    if (!scopeAccum[d.scope]) scopeAccum[d.scope] = { scope: d.scope, orders: 0, revenue: 0, marginTotal: 0 }
    scopeAccum[d.scope].orders++
    scopeAccum[d.scope].revenue += order.revenue
    scopeAccum[d.scope].marginTotal += d.margin

    dbg({ qty: d.qty, margin: d.margin, conflict: d.conflict ? `${d.conflict.nameProduct}→${d.conflict.priceProduct}` : undefined })
  }

  // ── Ad spend over the range ───────────────────────────────────────────────
  let adSpend = 0
  let adSpendSource = 'none'
  try {
    const perfRows = await supabaseGet(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
      select: 'date,meta_spend',
      date:   [`gte.${from}`, `lte.${to}`],
      limit:  '400',
    })
    if (perfRows.length > 0) {
      adSpend = perfRows.reduce((s, r) => s + (Number(r.meta_spend) || 0), 0)
      adSpendSource = 'v_daily_wix_meta_performance'
    }
  } catch (e) {
    errors.push(`v_daily_wix_meta_performance: ${String(e?.message ?? e)}`)
  }
  if (adSpendSource === 'none') {
    try {
      const adsRows = await supabaseGet(supabaseUrl, serviceKey, 'meta_ads_daily', {
        select: 'spend', date: [`gte.${from}`, `lte.${to}`], limit: '2000',
      })
      if (adsRows.length > 0) {
        adSpend = adsRows.reduce((s, r) => s + (Number(r.spend) || 0), 0)
        adSpendSource = 'meta_ads_daily'
      }
    } catch (e) {
      errors.push(`meta_ads_daily: ${String(e?.message ?? e)}`)
    }
  }

  // ── Profit ────────────────────────────────────────────────────────────────
  // Only margins that are actually known are counted. Orders without a margin
  // are excluded and reported as a hole — never folded in at margin 0.
  const ordersCount             = orders.length
  const marginBeforeAds         = knownMargin
  const estimatedProfitAfterAds = knownMargin - adSpend
  const estimatedProfitPerOrder = ordersCount > 0 ? estimatedProfitAfterAds / ordersCount : 0

  // One number the UI and Stanley can both quote: how many of the range's
  // orders contributed no margin, and which field the match broke on.
  const noMarginOrdersCount = unknownOrdersCount + unknownMarginOrdersCount + ambiguousOrdersCount
  const noMarginRevenue     = unknownRevenue + unknownMarginRevenue + ambiguousRevenue
  const noMarginFields      = [...new Set(
    [...unmappedOrders, ...unknownMarginOrders, ...ambiguousOrders].map(o => o.failed_field).filter(Boolean),
  )]

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok: true,
      timestamp: new Date().toISOString(),
      dateWarsaw: to,
      rangeFrom: from,
      rangeTo: to,
      ordersCount,
      orderRowsFetched: rangeRows.length,
      revenue: totalRevenue,
      adSpend,
      adSpendSource,
      knownMargin,
      unknownRevenue,
      unknownOrdersCount,
      unknownMarginRevenue,
      unknownMarginOrdersCount,
      ambiguousRevenue,
      ambiguousOrdersCount,
      ambiguousMinMargin,
      noMarginOrdersCount,
      noMarginRevenue,
      noMarginFields,
      conflictsCount: conflicts.length,
      conflicts,
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      productBreakdown: Object.values(productAccum),
      scopeBreakdown: Object.values(scopeAccum),
      unmappedOrders,
      unknownMarginOrders,
      ambiguousOrders,
      emailNormReclassified: 0,
      sourceTable: usedOrdersTable,
      debugOrders: debug ? debugOrders : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }),
  }
}
