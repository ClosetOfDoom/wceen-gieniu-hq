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
} from '../shared/productCatalog.js'
import {
  businessToday, businessWeekStart, businessDay, businessDaysAgo, businessDaysBetween,
} from '../shared/businessDay.js'
import { ALERT_RULES, countsAsOrder } from '../shared/alertRules.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

const JSON_HEADERS = { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

// The week start comes from ../shared/businessDay.js.


/**
 * The alarm rules need WHOLE Warsaw days, and they need to tell a day with no
 * sales apart from a day the sync never delivered. Neither can be read off the
 * daily view: it buckets by the UTC day, and it has no row at all for a day it
 * never received.
 *
 * So the series is built here, from `orders`, through the one day helper:
 *   · `hourly[24]` per day, so the in-progress day can be compared against the
 *     same hour on past days instead of against a straight line
 *   · `missing` for a day with no rows AT ALL, which is a suspected stuck sync
 *     and never a zero
 *
 * `today` is returned alongside but kept OUT of `series` — no alarm may fire on
 * a day that has not finished.
 */
function buildDailySeries(orders, today, windowDays) {
  const from = businessDaysAgo(windowDays, today)
  const counted = orders.filter(o => countsAsOrder(o.revenue))

  const hourlyByDay = new Map()
  const revenueByDay = new Map()
  for (const o of counted) {
    const ts = o.raw[0]?.order_created_at
    const date = ts ? businessDay(ts) : o.orderDate
    if (!date || date < from || date > today) continue
    if (!hourlyByDay.has(date)) hourlyByDay.set(date, new Array(24).fill(0))
    revenueByDay.set(date, (revenueByDay.get(date) ?? 0) + o.revenue)
    // Hour of the Warsaw wall clock, read from the same helper as the date.
    const hour = ts
      ? Number(new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false,
        }).format(new Date(ts))) % 24
      : 0
    hourlyByDay.get(date)[hour]++
  }

  // A day is `missing` only if NOTHING at all landed on it — including the test
  // orders we filtered out, which still prove the sync ran.
  const anyRowOnDay = new Set()
  for (const o of orders) {
    const ts = o.raw[0]?.order_created_at
    const d = ts ? businessDay(ts) : o.orderDate
    if (d) anyRowOnDay.add(d)
  }

  const series = []
  for (const date of businessDaysBetween(from, businessDaysAgo(1, today))) {
    const hourly = hourlyByDay.get(date) ?? null
    series.push({
      date,
      orders: hourly ? hourly.reduce((s, n) => s + n, 0) : 0,
      // Revenue on the SAME Warsaw-day basis as the count, so a 7-day ROAS is
      // not half from this calendar and half from the view's UTC one.
      revenue: revenueByDay.get(date) ?? 0,
      missing: !anyRowOnDay.has(date),
      hourly: hourly ?? new Array(24).fill(0),
    })
  }

  const todayHourly = hourlyByDay.get(today) ?? new Array(24).fill(0)
  // The first day the table has ANY row for. Days before it are prehistory,
  // not a stuck sync — without this the panel reds every day that predates
  // `orders` itself.
  const recordStartsOn = [...anyRowOnDay].sort()[0] ?? null
  return {
    recordStartsOn,
    series,
    today: {
      date: today,
      orders: todayHourly.reduce((s, n) => s + n, 0),
      revenue: revenueByDay.get(today) ?? 0,
      hourly: todayHourly,
    },
  }
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

  const today     = businessToday()
  const weekStart = businessWeekStart()

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

  // Enough history for the 7-day window, its 3-day streak check, and the
  // 120-day comparison the in-progress day is placed against.
  const dayWindow = buildDailySeries(orders, today, ALERT_RULES.TODAY_PERCENTILE_WINDOW_DAYS + 10)

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
      // Whole Warsaw days for the alarm rules — see buildDailySeries above.
      // `series` holds FULL days only; `today` is separate and never alarms.
      dailySeries:  dayWindow.series,
      recordStartsOn: dayWindow.recordStartsOn,
      todayHourly:  dayWindow.today,
      orderMinAmount: ALERT_RULES.ORDER_MIN_AMOUNT_PLN,
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
