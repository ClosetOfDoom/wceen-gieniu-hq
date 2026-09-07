// Netlify Function: product-sales
//
// JSU (549 PLN) and Językozak AI (347 PLN) sales computed from the `orders`
// table ALONE. No ClickMeeting, no registrations, no attendance — those
// pipelines stopped and anything derived from them would be a promise the data
// can no longer keep.
//
// Buckets by Warsaw calendar day and by ISO week (Monday start), each with the
// buyer list behind it. E-mails are masked, matching every other surface here.
//
// The price→product rules live in ./productCatalog.js, not here. This file only
// selects which two of the catalog's products it reports on.
//
//   GET /.netlify/functions/product-sales?days=30

import {
  PRODUCTS,
  aggregateOrders,
  classifyOrder,
  fetchOrdersInRange,
  maskEmail,
  warsawToday,
} from '../shared/productCatalog.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

// The two products this view reports on, keyed by their catalog product key.
const REPORTED = { jsu_course: 'jsu', jzk_ai: 'jzk' }

/** Monday of the ISO week containing a YYYY-MM-DD date. */
function weekStartOf(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const emptyBucket = () => ({ jsu: { count: 0, revenue: 0, buyers: [] }, jzk: { count: 0, revenue: 0, buyers: [] } })

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }),
    }
  }

  const days = Math.min(370, Math.max(1, parseInt((event.queryStringParameters || {}).days ?? '30', 10) || 30))
  const today = warsawToday()
  const fromISO = new Date(Date.parse(today + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10)

  let rows = []
  let usedTable = 'none'
  let fetchError = null
  for (const table of ['orders', 'wix_orders']) {
    try {
      rows = await fetchOrdersInRange(supabaseUrl, serviceKey, table, fromISO, today)
      usedTable = table
      fetchError = null
      break
    } catch (e) {
      fetchError = String(e?.message ?? e)
    }
  }
  if (usedTable === 'none') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: `Could not read orders: ${fetchError}` }) }
  }

  const byDay = new Map()
  const byWeek = new Map()
  const totals = emptyBucket()
  const orders = aggregateOrders(rows)

  for (const order of orders) {
    const d = classifyOrder(order)
    const key = REPORTED[d.productKey]
    if (!key) continue

    const buyer = {
      email: maskEmail(order.email),
      amount: order.revenue,
      date: order.orderDate,
      at: order.raw[0]?.order_created_at ?? order.orderDate,
      product_name_raw: order.productNameRaw,
    }

    for (const [map, mapKey] of [[byDay, order.orderDate], [byWeek, weekStartOf(order.orderDate)]]) {
      if (!map.has(mapKey)) map.set(mapKey, emptyBucket())
      const b = map.get(mapKey)[key]
      b.count++
      b.revenue += order.revenue
      b.buyers.push(buyer)
    }
    totals[key].count++
    totals[key].revenue += order.revenue
    totals[key].buyers.push(buyer)
  }

  const serialise = (map) =>
    [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, v]) => ({ key, ...v }))

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      source_table: usedTable,
      today_warsaw: today,
      from: fromISO,
      days,
      ordersScannedInRange: orders.length,
      priceTable: {
        [PRODUCTS.jsu_course.catalogPrice]: `${PRODUCTS.jsu_course.displayName} (JSU)`,
        [PRODUCTS.jzk_ai.catalogPrice]:     PRODUCTS.jzk_ai.displayName,
      },
      totals,
      byDay: serialise(byDay),
      byWeek: serialise(byWeek),
    }),
  }
}
