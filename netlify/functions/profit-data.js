// Netlify Function: profit-data
// Estimated operational profit for a Warsaw date range (default: today).
// Uses service role key — bypasses RLS.
// Methodology: contribution margin per product − ad spend, over the range.
// See docs/profit_metrics.md for full explanation.
//
// Query params (all optional):
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD  → aggregate the inclusive Warsaw range
//   ?date=YYYY-MM-DD                → a single day (shortcut for from=to=date)
//   ?debug=1                        → also return the raw matched orders

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Product classification for MARGIN — amount FIRST, then name (robust to
//    discounted/variant prices). KEEP IN SYNC with orders-data.js classifyOrder
//    and src/services/productMargins.ts. Margins: JSU 500 | JZK AI 320 |
//    Pakiet Pamięciowy 70 | Pakiet Językowy 40. ─────────────────────────────────

// Narrow, deliberate patterns (see orders-data.js for the rationale).
// JSU requires "kurs" so a PP bundle that merely lists "Jak się uczyć" as a bonus
// is NEVER classified as JSU.
const JSU_NAME_PATTERNS  = ['kurs jak sie uczyc', 'kurs jak', 'jsu', 'nauka uczenia']
const JZK_MAIN_PATTERNS  = ['jezykozak', 'jzk', 'nauka jezykow', 'nauka jezyk']
// Pakiet Językowy incl. the 3T-TRIPWIRE language product ("3 Zadziwiające
// Techniki Nauki Języków"), which sells at 114 AND 115 PLN under varied names.
const LANG_PACK_PATTERNS = ['pakiet jezykowy', 'jezykowy', 'zadziwiajace techniki', 'techniki nauki jezyk', '3 zadziwiajace']
// WSZTP (Wakacyjna Szkoła Treningu Pamięci) — high-ticket, deposit 1250 / full 3450.
// Its contribution margin is NOT known, so it must NOT silently take the PP margin
// (the broad 'pamiec' pattern would grab it). Route to UNMAPPED (visible) instead.
const WSZTP_PATTERNS     = ['wsztp', 'wakacyjna', 'treningu pamieci', 'szko a treningu']
const MEMORY_PATTERNS    = ['pakiet pamieciowy', 'trening pamiec', 'trening interaktywny', 'super pamiec', 'pamiec', 'memory pack']

// Cost-based margin model. unit_cost = catalog price − briefing margin.
//   PP  119 − 70  = 49    PL  114 − 40  = 74
//   JSU 549 − 500 = 49    JZK 347 − 320 = 27
// The orders table has NO quantity column (verified), so quantity is INFERRED from
// the order value (see bucketize). Order margin = value − unit_cost × quantity.
const PRODUCTS = {
  jsu_course:    { displayName: 'Kurs Jak się uczyć', price: 549, unitCost: 49 },
  jzk_ai:        { displayName: 'Językozak AI',        price: 347, unitCost: 27 },
  memory_pack:   { displayName: 'Pakiet Pamięciowy',   price: 119, unitCost: 49 },
  language_pack: { displayName: 'Pakiet Językowy',     price: 114, unitCost: 74 },
}
const QTY_TOLERANCE = 0.15  // value must be within 15% of a whole multiple of price

// Decide the bucket for an order already matched (by name/price) to a product.
//   MAPPED    — either a single discounted unit (value < catalog price → qty 1,
//               never ambiguous "down"), OR value ≈ qty × catalog price within 15%
//               (qty = round(value/price)). margin = value − unit_cost × qty.
//   AMBIGUOUS — ONLY for values ABOVE the catalog price that no whole multiple
//               explains within 15%, OR a cross-product price collision (value
//               equals a DIFFERENT product's catalog price — e.g. a "Pamięć…" order
//               at 347 = Językozak's price). AMBIGUOUS is revenue, NOT margin; but
//               we still report a LOWER-BOUND margin = value − unit_cost × ceil(
//               value/price) (max plausible units → min margin) — surfaced in the
//               UI as "minimum", never added to Est. Profit.
function ambiguousResult(p, value, reason) {
  const minMargin = value - p.unitCost * Math.ceil(value / p.price)
  return { bucket: 'AMBIGUOUS', reason, minMargin }
}
function bucketize(productKey, value) {
  const p = PRODUCTS[productKey]
  // Below catalog price → one discounted unit. MAPPED qty 1. Never AMBIGUOUS down.
  if (value < p.price) return { bucket: 'MAPPED', qty: 1, margin: value - p.unitCost }
  // At/above catalog price — cross-product exact price collision → ambiguous.
  const collides = Object.entries(PRODUCTS).some(([k, q]) => k !== productKey && Math.abs(value - q.price) < 1)
  if (collides) return ambiguousResult(p, value, `value ${value} equals another product's catalog price`)
  const qty = Math.round(value / p.price)
  if (Math.abs(value - qty * p.price) < QTY_TOLERANCE * (qty * p.price)) {
    return { bucket: 'MAPPED', qty, margin: value - p.unitCost * qty }
  }
  return ambiguousResult(p, value, `value ${value} above ${p.price} not within 15% of a whole multiple`)
}

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function anyMatch(norm, patterns) {
  return patterns.some(p => norm.includes(p))
}

// Returns { productKey, displayName, margin, matchedBy } or null (unmapped).
// ORDER MATTERS. NAME first: the product name is authoritative even when the price
// coincides with another product's list price (e.g. a discounted PP sold at 114 or
// 347 must stay Memory, not become Językowy/Językozak). JSU requires "kurs", so a PP
// bundle that merely lists "Jak się uczyć" as a bonus stays Memory. Price is only a
// fallback for rows whose name doesn't identify the product. Anything unmatched → null
// (UNMAPPED, visible in the UI) — never a silent margin 0.
function classifyForMargin(amount, rawName) {
  const norm = normalizeText(rawName)
  const P = (key, by) => ({ productKey: key, ...PRODUCTS[key], matchedBy: by })

  // 0 — WSZTP high-ticket: recognized product, margin unknown → UNMAPPED (before the
  //     broad 'pamiec' pattern could mis-map it to the PP margin).
  if (norm && anyMatch(norm, WSZTP_PATTERNS)) return null

  // 1 — NAME first
  if (norm) {
    if (anyMatch(norm, JSU_NAME_PATTERNS))  return P('jsu_course',    `name "${norm.slice(0, 30)}"`)
    if (anyMatch(norm, JZK_MAIN_PATTERNS))  return P('jzk_ai',        `name "${norm.slice(0, 30)}"`)
    if (anyMatch(norm, LANG_PACK_PATTERNS)) return P('language_pack', `name "${norm.slice(0, 30)}"`)
    if (anyMatch(norm, MEMORY_PATTERNS))    return P('memory_pack',   `name "${norm.slice(0, 30)}"`)
  }

  // 2 — price fallback (unnamed / unrecognized name at a known list price)
  if (amount === 549) return P('jsu_course',    'price 549')
  if (amount === 347) return P('jzk_ai',        'price 347')
  if (amount === 119) return P('memory_pack',   'price 119')
  if (amount === 114) return P('language_pack', 'price 114')
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function warsawToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

// Convert any order date value to a Warsaw calendar date (YYYY-MM-DD). If already
// a plain date, keep it. This fixes UTC-vs-Warsaw off-by-one bucketing that made
// evening/early orders fall on the wrong day and vanish from "today".
function toWarsawDate(val) {
  if (val == null) return ''
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) }
  catch { return s.slice(0, 10) }
}

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

function extractOrderDate(row) {
  return toWarsawDate(
    row.order_created_at ?? row.order_date ?? row.created_at ?? row.date ?? row.created ?? '',
  )
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

function extractOrderEmail(row) {
  const raw = String(row.buyer_email ?? row.email ?? row.customer_email ?? row.contact_email ?? '').trim().toLowerCase()
  const m = raw.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/)
  return m ? m[0] : ''
}

function normalizeEmail(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  const m = s.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/)
  return m ? m[0] : ''
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
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
    const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ ok: false, error: `Server env missing: ${missing}` }),
    }
  }

  const qp = event.queryStringParameters || {}
  const today = warsawToday()
  const from  = qp.from || qp.date || today
  const to    = qp.to   || qp.date || from
  const debug = qp.debug === '1'
  const errors = []

  // ── Fetch orders (service role) ───────────────────────────────────────────
  let allOrders = []
  let usedOrdersTable = 'none'
  for (const tableName of ['orders', 'wix_orders']) {
    try {
      // Fetch all orders (a plain small limit returned the oldest rows once the
      // table grew, so recent/today orders were missed → margin computed on 0 orders).
      allOrders = await supabaseGet(supabaseUrl, serviceKey, tableName, { select: '*', limit: '5000' })
      usedOrdersTable = tableName
      break
    } catch (e) {
      errors.push(`orders fetch (${tableName}): ${String(e?.message ?? e)}`)
    }
  }

  // Filter to the requested Warsaw range [from, to]
  const rangeOrders = allOrders.filter(row => {
    const d = extractOrderDate(row)
    return d >= from && d <= to
  })

  // ── Classify → bucket (MAPPED / AMBIGUOUS / UNMAPPED) and compute margins ──
  const productAccum = {}
  let knownMargin = 0, totalRevenue = 0
  let unknownRevenue = 0, unknownOrdersCount = 0       // UNMAPPED
  let ambiguousRevenue = 0, ambiguousOrdersCount = 0   // AMBIGUOUS (revenue, no margin)
  let ambiguousMinMargin = 0                            // lower-bound margin of AMBIGUOUS
  const unmappedOrders = []
  const ambiguousOrders = []
  const debugOrders = []

  for (const row of rangeOrders) {
    const amount = extractAmount(row)
    const name   = extractProductNameRaw(row)
    totalRevenue += amount
    const rule = classifyForMargin(amount, name)
    const dbgBase = { amount, product_name_raw: name ?? '—', order_date: extractOrderDate(row) }

    if (!rule) {
      unknownRevenue += amount
      unknownOrdersCount++
      unmappedOrders.push({ ...dbgBase, note: 'no price or name match' })
      if (debug) debugOrders.push({ ...dbgBase, matched: 'UNMAPPED', bucket: 'UNMAPPED', qty: 0, margin: 0 })
      continue
    }

    const b = bucketize(rule.productKey, amount)
    if (b.bucket === 'AMBIGUOUS') {
      ambiguousRevenue += amount
      ambiguousOrdersCount++
      ambiguousMinMargin += b.minMargin
      ambiguousOrders.push({ ...dbgBase, matched: rule.productKey, minMargin: b.minMargin, note: b.reason })
      if (debug) debugOrders.push({ ...dbgBase, matched: `${rule.productKey} (${rule.matchedBy})`, bucket: 'AMBIGUOUS', qty: null, margin: 0, minMargin: b.minMargin, reason: b.reason })
      continue
    }

    // MAPPED
    knownMargin += b.margin
    if (!productAccum[rule.productKey]) {
      productAccum[rule.productKey] = { productKey: rule.productKey, displayName: PRODUCTS[rule.productKey].displayName, orders: 0, units: 0, revenue: 0, unitCost: PRODUCTS[rule.productKey].unitCost, contributionMargin: null, marginTotal: 0 }
    }
    productAccum[rule.productKey].orders++
    productAccum[rule.productKey].units += b.qty
    productAccum[rule.productKey].revenue += amount
    productAccum[rule.productKey].marginTotal += b.margin
    if (debug) debugOrders.push({ ...dbgBase, matched: `${rule.productKey} (${rule.matchedBy})`, bucket: 'MAPPED', qty: b.qty, margin: b.margin })
  }

  // NOTE: the previous "email → webinar" heuristic (reclassifying an unmapped order
  // as JSU because the buyer's e-mail was in webinar_participants) has been REMOVED.
  // No order's product is ever changed based on data outside the orders table.

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

  // ── Compute profit ────────────────────────────────────────────────────────
  const productBreakdownFinal   = Object.values(productAccum)
  const marginBeforeAds         = knownMargin
  const estimatedProfitAfterAds = knownMargin - adSpend
  const ordersCount             = rangeOrders.length
  const estimatedProfitPerOrder = ordersCount > 0 ? estimatedProfitAfterAds / ordersCount : 0

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: true,
      timestamp: new Date().toISOString(),
      dateWarsaw: to,
      rangeFrom: from,
      rangeTo: to,
      ordersCount,
      revenue: totalRevenue,
      adSpend,
      adSpendSource,
      knownMargin,
      unknownRevenue,
      unknownOrdersCount,
      ambiguousRevenue,
      ambiguousOrdersCount,
      ambiguousMinMargin,
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      productBreakdown: productBreakdownFinal,
      unmappedOrders,
      ambiguousOrders,
      emailNormReclassified: 0,
      sourceTable: usedOrdersTable,
      debugOrders: debug ? debugOrders : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }),
  }
}
