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

// Products: catalogPrice (used only for whole-multiple inference on non-canonical
// amounts) + unitCost (authoritative, per the canonical table). WSZTP has an unknown
// unit cost → margin is never computed for it.
const PRODUCTS = {
  memory_pack:   { displayName: 'Pakiet Pamięciowy',   catalogPrice: 119,  unitCost: 49 },
  language_pack: { displayName: 'Pakiet Językowy 3T',  catalogPrice: 114,  unitCost: 64 },
  jzk_ai:        { displayName: 'Językozak AI',         catalogPrice: 347,  unitCost: 27 },
  jsu_course:    { displayName: 'Kurs Jak się uczyć',   catalogPrice: 549,  unitCost: 49 },
  wsztp:         { displayName: 'WSZTP',                catalogPrice: 1250, unitCost: null },
}
// Canonical exact prices → product. PRICE WINS OVER NAME. 99 = Pakiet Pamięciowy
// sold without the shipping fee (form error). 1250 = WSZTP (unknown margin).
const CANONICAL = { 99: 'memory_pack', 119: 'memory_pack', 114: 'language_pack', 347: 'jzk_ai', 549: 'jsu_course', 1250: 'wsztp' }
const QTY_TOLERANCE = 0.15  // value must be within 15% of a whole multiple of price

// Name → product key (one of the four margin products) or null. WSZTP by name is
// handled separately by the caller (WSZTP_PATTERNS).
function nameMatchKey(norm) {
  if (!norm) return null
  if (anyMatch(norm, JSU_NAME_PATTERNS))  return 'jsu_course'
  if (anyMatch(norm, JZK_MAIN_PATTERNS))  return 'jzk_ai'
  if (anyMatch(norm, LANG_PACK_PATTERNS)) return 'language_pack'
  if (anyMatch(norm, MEMORY_PATTERNS))    return 'memory_pack'
  return null
}

// PRICE-PRIMARY classification. Returns a decision object or null (UNMAPPED):
//   { productKey, bucket, qty?, margin?, minMargin?, conflict?, matchedBy }
//   bucket ∈ MAPPED | AMBIGUOUS | UNKNOWN_MARGIN
//   conflict = { priceProduct, priceAmount, nameProduct } when the name points to a
//   different product than the canonical price (we map by PRICE, flag the conflict).
function classifyOrder(amount, rawName) {
  const norm = normalizeText(rawName)
  const nameIsWsztp = !!norm && anyMatch(norm, WSZTP_PATTERNS)
  const nameKey = nameMatchKey(norm)

  // 1 — EXACT canonical price wins over the name.
  const canonKey = Object.prototype.hasOwnProperty.call(CANONICAL, amount) ? CANONICAL[amount] : null
  if (canonKey) {
    if (canonKey === 'wsztp') return { productKey: 'wsztp', bucket: 'UNKNOWN_MARGIN', matchedBy: `price ${amount}` }
    const p = PRODUCTS[canonKey]
    const namePoints = nameIsWsztp ? 'wsztp' : nameKey
    const conflict = (namePoints && namePoints !== canonKey)
      ? { priceProduct: canonKey, priceAmount: amount, nameProduct: namePoints }
      : null
    // A canonical price is a single unit at that price.
    return { productKey: canonKey, bucket: 'MAPPED', qty: 1, margin: amount - p.unitCost, matchedBy: `price ${amount}`, conflict }
  }

  // 2 — WSZTP by name (non-canonical amount) → unknown margin.
  if (nameIsWsztp) return { productKey: 'wsztp', bucket: 'UNKNOWN_MARGIN', matchedBy: 'name' }

  // 3 — name-matched product at a NON-canonical amount.
  if (nameKey) {
    const p = PRODUCTS[nameKey]
    // Below catalog price → one discounted unit. MAPPED qty 1. Never AMBIGUOUS down.
    if (amount < p.catalogPrice) {
      return { productKey: nameKey, bucket: 'MAPPED', qty: 1, margin: amount - p.unitCost, matchedBy: 'name (below catalog)' }
    }
    // At/above catalog price → whole-multiple within 15%, else AMBIGUOUS.
    const qty = Math.round(amount / p.catalogPrice)
    if (Math.abs(amount - qty * p.catalogPrice) < QTY_TOLERANCE * (qty * p.catalogPrice)) {
      return { productKey: nameKey, bucket: 'MAPPED', qty, margin: amount - p.unitCost * qty, matchedBy: `name ×${qty}` }
    }
    const minMargin = amount - p.unitCost * Math.ceil(amount / p.catalogPrice)
    return { productKey: nameKey, bucket: 'AMBIGUOUS', minMargin, matchedBy: 'name', reason: `${amount} above ${p.catalogPrice}, no whole multiple within 15%` }
  }

  // 4 — nothing matched → UNMAPPED.
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
  let unknownRevenue = 0, unknownOrdersCount = 0             // UNMAPPED (unrecognized)
  let unknownMarginRevenue = 0, unknownMarginOrdersCount = 0 // WSZTP — known product, unknown margin
  let ambiguousRevenue = 0, ambiguousOrdersCount = 0         // AMBIGUOUS (revenue, no margin)
  let ambiguousMinMargin = 0                                  // lower-bound margin of AMBIGUOUS
  const unmappedOrders = []
  const unknownMarginOrders = []
  const ambiguousOrders = []
  const conflicts = []                                        // PRICE/NAME CONFLICT rows
  const debugOrders = []

  for (const row of rangeOrders) {
    const amount = extractAmount(row)
    const name   = extractProductNameRaw(row)
    totalRevenue += amount
    const d = classifyOrder(amount, name)
    const dbgBase = { amount, product_name_raw: name ?? '—', order_date: extractOrderDate(row) }

    if (!d) {   // UNMAPPED — no price or name match
      unknownRevenue += amount
      unknownOrdersCount++
      unmappedOrders.push({ ...dbgBase, note: 'no price or name match' })
      if (debug) debugOrders.push({ ...dbgBase, matched: 'UNMAPPED', bucket: 'UNMAPPED', qty: 0, margin: 0 })
      continue
    }

    // Record a PRICE/NAME CONFLICT (mapped by price, name pointed elsewhere)
    if (d.conflict) {
      conflicts.push({
        ...dbgBase,
        price_product: PRODUCTS[d.conflict.priceProduct].displayName,
        price_amount: d.conflict.priceAmount,
        name_product: PRODUCTS[d.conflict.nameProduct]?.displayName ?? d.conflict.nameProduct,
      })
    }

    if (d.bucket === 'UNKNOWN_MARGIN') {   // WSZTP — known product, unknown margin
      unknownMarginRevenue += amount
      unknownMarginOrdersCount++
      unknownMarginOrders.push({ ...dbgBase, matched: d.productKey, note: 'known product, unknown margin (WSZTP)' })
      if (debug) debugOrders.push({ ...dbgBase, matched: `${d.productKey} (${d.matchedBy})`, bucket: 'UNKNOWN_MARGIN', qty: null, margin: 0 })
      continue
    }

    if (d.bucket === 'AMBIGUOUS') {
      ambiguousRevenue += amount
      ambiguousOrdersCount++
      ambiguousMinMargin += d.minMargin
      ambiguousOrders.push({ ...dbgBase, matched: d.productKey, minMargin: d.minMargin, note: d.reason })
      if (debug) debugOrders.push({ ...dbgBase, matched: `${d.productKey} (${d.matchedBy})`, bucket: 'AMBIGUOUS', qty: null, margin: 0, minMargin: d.minMargin, reason: d.reason })
      continue
    }

    // MAPPED
    knownMargin += d.margin
    if (!productAccum[d.productKey]) {
      productAccum[d.productKey] = { productKey: d.productKey, displayName: PRODUCTS[d.productKey].displayName, orders: 0, units: 0, revenue: 0, unitCost: PRODUCTS[d.productKey].unitCost, contributionMargin: null, marginTotal: 0 }
    }
    productAccum[d.productKey].orders++
    productAccum[d.productKey].units += d.qty
    productAccum[d.productKey].revenue += amount
    productAccum[d.productKey].marginTotal += d.margin
    if (debug) debugOrders.push({ ...dbgBase, matched: `${d.productKey} (${d.matchedBy})`, bucket: 'MAPPED', qty: d.qty, margin: d.margin, conflict: d.conflict ? `${d.conflict.nameProduct}→${d.conflict.priceProduct}` : undefined })
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
      unknownMarginRevenue,
      unknownMarginOrdersCount,
      ambiguousRevenue,
      ambiguousOrdersCount,
      ambiguousMinMargin,
      conflictsCount: conflicts.length,
      conflicts,
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      productBreakdown: productBreakdownFinal,
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
