// Netlify Function: orders-data
// Canonical orders backend using service role (bypasses RLS).
// Provides classified order counts for today, this week, and all time.
// All UI and GIENIU answers for order queries must use this source.
//
// Every price, margin, scope and classification rule comes from
// ./productCatalog.js — the same module profit-data.js uses, so the PP count on
// the Est. Profit card and the PP count here can never disagree again.

import {
  PRODUCTS,
  aggregateOrders,
  classifyOrder,
  fetchAllOrders,
  maskEmail,
  warsawToday,
} from './productCatalog.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

function warsawWeekStart() {
  const d = new Date(warsawToday() + 'T12:00:00Z')
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return monday.toISOString().slice(0, 10)
}

// The frontend contract (src/lib/ordersData.ts) has four buckets. They are
// derived from the catalog, not from a second set of rules:
//   MEMORY_PACK  ← the memory_pack product
//   JSU_COURSE   ← the jsu_course product
//   JZK_LANGUAGE ← every product with scope 'language'
//   UNKNOWN      ← everything else, incl. unmapped and margin-less products
function bucketOf(decision) {
  if (decision.productKey === 'memory_pack') return 'MEMORY_PACK'
  if (decision.productKey === 'jsu_course')  return 'JSU_COURSE'
  if (decision.scope === 'language')         return 'JZK_LANGUAGE'
  return 'UNKNOWN'
}

function labelOf(decision) {
  if (!decision.productKey) return 'Nieznany'
  return PRODUCTS[decision.productKey].displayName
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

  const today     = warsawToday()
  const weekStart = warsawWeekStart()

  let rows = []
  let usedTable = 'none'
  let fetchError = null
  for (const tableName of ['orders', 'wix_orders']) {
    try {
      rows = await fetchAllOrders(supabaseUrl, serviceKey, tableName)
      usedTable = tableName
      fetchError = null
      break
    } catch (e) {
      fetchError = String(e?.message ?? e)
    }
  }

  if (usedTable === 'none') {
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: `Could not access orders table: ${fetchError}`,
        today_warsaw: today,
        week_start:   weekStart,
      }),
    }
  }

  const orders = aggregateOrders(rows)
  orders.sort((a, b) => b.orderDate.localeCompare(a.orderDate))

  const zero = () => ({ count: 0, revenue: 0 })
  const all   = { JSU_COURSE: zero(), JZK_LANGUAGE: zero(), MEMORY_PACK: zero(), UNKNOWN: zero() }
  const daily = { JSU_COURSE: zero(), JZK_LANGUAGE: zero(), MEMORY_PACK: zero(), UNKNOWN: zero() }

  let latestOrderDate = null
  let todayCount = 0, todayRevenue = 0
  let weekCount  = 0, weekRevenue  = 0
  let priceWarnings = 0
  const latest20 = []

  for (const order of orders) {
    const d = classifyOrder(order)
    const bucket = bucketOf(d)

    if (!latestOrderDate && order.orderDate) latestOrderDate = order.orderDate

    all[bucket].count++
    all[bucket].revenue += order.revenue

    if (order.orderDate === today) {
      todayCount++
      todayRevenue += order.revenue
      daily[bucket].count++
      daily[bucket].revenue += order.revenue
    }
    if (order.orderDate >= weekStart) {
      weekCount++
      weekRevenue += order.revenue
    }

    // A warning is a real disagreement between the price and the product name —
    // the order is still mapped by price, but the mismatch stays visible.
    const warning = d.conflict
      ? `price ${d.conflict.priceAmount} PLN → ${PRODUCTS[d.conflict.priceProduct].displayName}, but name points to ${PRODUCTS[d.conflict.nameProduct]?.displayName ?? d.conflict.nameProduct}`
      : null
    if (warning) priceWarnings++

    if (latest20.length < 20) {
      latest20.push({
        external_order_id:      order.orderId || '—',
        email_masked:           maskEmail(order.email),
        product_name_raw:       order.productNameRaw ?? '—',
        amount:                 order.revenue,
        order_date:             order.orderDate,
        classified_product:     bucket,
        product_label:          labelOf(d),
        classification_reason:  d.matchedBy ?? `unmapped — ${d.failedField}`,
        classification_warning: warning,
      })
    }
  }

  return {
    statusCode: 200,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ok:           true,
      timestamp:    new Date().toISOString(),
      today_warsaw: today,
      week_start:   weekStart,
      source_table: usedTable,
      totals: {
        all_orders:        orders.length,
        order_rows:        rows.length,
        latest_order_date: latestOrderDate,
        today_orders:      todayCount,
        today_revenue:     todayRevenue,
        week_orders:       weekCount,
        week_revenue:      weekRevenue,
      },
      classified: {
        jsu_course:     all.JSU_COURSE,
        jzk_language:   all.JZK_LANGUAGE,
        memory_pack:    all.MEMORY_PACK,
        unknown:        { count: all.UNKNOWN.count, revenue: all.UNKNOWN.revenue },
        price_warnings: priceWarnings,
      },
      today_classified: {
        jsu_course:   daily.JSU_COURSE,
        jzk_language: daily.JZK_LANGUAGE,
        memory_pack:  daily.MEMORY_PACK,
        unknown:      { count: daily.UNKNOWN.count, revenue: daily.UNKNOWN.revenue },
      },
      latest_20_orders: latest20,
    }),
  }
}
