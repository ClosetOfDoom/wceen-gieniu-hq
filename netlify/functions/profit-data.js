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
} from '../shared/productCatalog.js'
import { readTable } from '../shared/supabaseRead.js'
import { toWarsawDate } from '../shared/productCatalog.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

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

  // How many of this range's orders fall on a DIFFERENT calendar day under the
  // daily view's basis than under ours.
  //
  // v_daily_wix_meta_performance buckets with `order_created_at::date`, i.e. the
  // UTC day; this endpoint buckets by the Warsaw day, which is the business's own
  // calendar. Orders placed between 22:00 and 24:00 UTC (midnight to 02:00 in
  // Warsaw) therefore land on different days in the two places. Nothing is lost
  // — the totals over any two consecutive days are identical — but a single-day
  // count can differ, so reconciliation has to know by how much it legitimately
  // can. supabase/migrations/view_daily_performance_warsaw_day.sql removes the
  // discrepancy at the source; it needs applying by hand in Supabase.
  const dayBoundaryOrders = orders.filter(order => {
    const ts = order.raw[0]?.order_created_at
    if (!ts) return false
    const utcDay = String(ts).slice(0, 10)
    return utcDay !== toWarsawDate(ts)
  }).length

  // ── Classify and accumulate ───────────────────────────────────────────────
  const productAccum = {}
  const scopeAccum   = {}
  let knownMargin = 0, totalRevenue = 0
  let unknownRevenue = 0, unknownOrdersCount = 0             // UNMAPPED
  let unknownMarginRevenue = 0, unknownMarginOrdersCount = 0 // product known, margin null
  let ambiguousRevenue = 0, ambiguousOrdersCount = 0
  let ambiguousMinMargin = 0
  let excludedRevenue = 0, excludedOrdersCount = 0   // WSZTP — out on purpose
  const unmappedOrders = []
  const unknownMarginOrders = []
  const ambiguousOrders = []
  const excludedOrders = []
  const excludedAccum = {}
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

    // EXCLUDED — a known product deliberately kept out of every blended figure.
    // It is NOT unmapped: nothing is missing from the catalog, so it must never
    // be counted in the "N bez mapowania" figure that asks somebody to act.
    if (d.bucket === 'EXCLUDED') {
      excludedRevenue += order.revenue
      excludedOrdersCount++
      excludedOrders.push({ ...dbgBase, product: PRODUCTS[d.productKey].displayName, reason: d.excludedReason })
      if (!excludedAccum[d.productKey]) {
        const p = PRODUCTS[d.productKey]
        excludedAccum[d.productKey] = { productKey: d.productKey, displayName: p.displayName, scope: p.scope, orders: 0, revenue: 0, reason: d.excludedReason }
      }
      excludedAccum[d.productKey].orders++
      excludedAccum[d.productKey].revenue += order.revenue
      dbg({ qty: d.qty, margin: 0 })
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
    const perfRows = await readTable(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
      select:  'date,meta_spend',
      order:   'date.asc',
      filters: { date: [`gte.${from}`, `lte.${to}`] },
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
      const adsRows = await readTable(supabaseUrl, serviceKey, 'meta_ads_daily', {
        select:  'spend',
        order:   'date.asc',
        filters: { date: [`gte.${from}`, `lte.${to}`] },
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
  // are left out and reported as a hole — never folded in at margin 0.
  //
  // BLENDED vs TOTAL. `ordersCount` / `revenue` are everything that came in, so
  // they still reconcile with the Wix cards. The blended figures — profit, CPA,
  // ROAS, profit per order — run on the orders the ad spend could plausibly have
  // bought, i.e. everything except the EXCLUDED ones (WSZTP). A single 3450 PLN
  // camp deposit against ~500 PLN of daily spend would otherwise invent a ROAS.
  const ordersCount             = orders.length
  const blendedOrdersCount      = ordersCount - excludedOrdersCount
  const blendedRevenue          = totalRevenue - excludedRevenue
  const marginBeforeAds         = knownMargin
  const estimatedProfitAfterAds = knownMargin - adSpend
  const estimatedProfitPerOrder = blendedOrdersCount > 0 ? estimatedProfitAfterAds / blendedOrdersCount : 0
  const realCpa                 = blendedOrdersCount > 0 ? adSpend / blendedOrdersCount : null
  const realRoas                = adSpend > 0 ? blendedRevenue / adSpend : null

  // One number the UI and Stanley can both quote: how many of the range's
  // orders contributed no margin BECAUSE SOMETHING IS MISSING, and which field
  // the match broke on. Deliberate exclusions are counted separately — asking
  // someone to "map" WSZTP would be asking them to undo a decision.
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
      // Orders whose UTC day differs from their Warsaw day. This is the exact
      // slack a single-day reconciliation against the daily view may show.
      dayBoundaryOrders,
      blendedOrdersCount,
      blendedRevenue,
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
      excludedOrdersCount,
      excludedRevenue,
      excludedBreakdown: Object.values(excludedAccum),
      excludedOrders,
      conflictsCount: conflicts.length,
      conflicts,
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      realCpa,
      realRoas,
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
