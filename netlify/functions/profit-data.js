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
const LANG_PACK_PATTERNS = ['pakiet jezykowy', 'jezykowy']
const MEMORY_PATTERNS    = ['pakiet pamieciowy', 'trening pamiec', 'trening interaktywny', 'super pamiec', 'pamiec', 'memory pack']

const PRODUCTS = {
  jsu_course:    { displayName: 'Kurs Jak się uczyć', margin: 500 },
  jzk_ai:        { displayName: 'Językozak AI',        margin: 320 },
  memory_pack:   { displayName: 'Pakiet Pamięciowy',   margin: 70  },
  language_pack: { displayName: 'Pakiet Językowy',     margin: 40  },
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
function classifyForMargin(amount, rawName) {
  // 1 — absolute price rule (fast, unambiguous)
  if (amount === 549) return { productKey: 'jsu_course',    ...PRODUCTS.jsu_course,    matchedBy: 'price 549' }
  if (amount === 347) return { productKey: 'jzk_ai',        ...PRODUCTS.jzk_ai,        matchedBy: 'price 347' }
  if (amount === 119) return { productKey: 'memory_pack',   ...PRODUCTS.memory_pack,   matchedBy: 'price 119' }
  if (amount === 114) return { productKey: 'language_pack', ...PRODUCTS.language_pack, matchedBy: 'price 114' }

  // 2 — name fallback (handles discounts / variant prices that are not the list price)
  const norm = normalizeText(rawName)
  if (norm) {
    if (anyMatch(norm, JSU_NAME_PATTERNS))  return { productKey: 'jsu_course',    ...PRODUCTS.jsu_course,    matchedBy: `name "${norm.slice(0, 30)}"` }
    if (anyMatch(norm, JZK_MAIN_PATTERNS))  return { productKey: 'jzk_ai',        ...PRODUCTS.jzk_ai,        matchedBy: `name "${norm.slice(0, 30)}"` }
    if (anyMatch(norm, MEMORY_PATTERNS))    return { productKey: 'memory_pack',   ...PRODUCTS.memory_pack,   matchedBy: `name "${norm.slice(0, 30)}"` }
    if (anyMatch(norm, LANG_PACK_PATTERNS)) return { productKey: 'language_pack', ...PRODUCTS.language_pack, matchedBy: `name "${norm.slice(0, 30)}"` }
  }
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
      allOrders = await supabaseGet(supabaseUrl, serviceKey, tableName, { select: '*', limit: '1000' })
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

  // ── Classify and compute margins ──────────────────────────────────────────
  const productAccum = {}
  let knownMargin = 0, unknownRevenue = 0, unknownOrdersCount = 0, totalRevenue = 0
  const unmappedOrders = []
  const debugOrders = []

  for (const row of rangeOrders) {
    const amount = extractAmount(row)
    const name   = extractProductNameRaw(row)
    totalRevenue += amount
    const rule = classifyForMargin(amount, name)

    if (debug) debugOrders.push({ amount, product_name_raw: name ?? '—', order_date: extractOrderDate(row), matched: rule ? `${rule.productKey} (${rule.matchedBy})` : 'UNMAPPED', margin: rule?.margin ?? 0 })

    if (!rule) {
      unknownRevenue += amount
      unknownOrdersCount++
      unmappedOrders.push({ amount, product_name_raw: name ?? '—', order_date: extractOrderDate(row), note: 'no price or name match' })
      continue
    }
    knownMargin += rule.margin
    if (!productAccum[rule.productKey]) {
      productAccum[rule.productKey] = { productKey: rule.productKey, displayName: rule.displayName, orders: 0, revenue: 0, contributionMargin: rule.margin, marginTotal: 0 }
    }
    productAccum[rule.productKey].orders++
    productAccum[rule.productKey].revenue += amount
    productAccum[rule.productKey].marginTotal += rule.margin
  }

  // ── Email-norm join: reclassify unmapped orders via webinar participants → JSU
  let emailNormReclassified = 0
  const emailNormWarnings = []
  if (unmappedOrders.length > 0) {
    try {
      const participants = await supabaseGet(supabaseUrl, serviceKey, 'webinar_participants', { select: 'email', limit: '2000' })
      const participantEmailSet = new Set(participants.map(p => normalizeEmail(p.email)).filter(e => e.includes('@')))
      if (participantEmailSet.size > 0) {
        const stillUnmapped = []
        for (const raw of rangeOrders) {
          const amount = extractAmount(raw)
          if (classifyForMargin(amount, extractProductNameRaw(raw))) continue  // already classified
          const email = extractOrderEmail(raw)
          if (email && participantEmailSet.has(email)) {
            knownMargin += PRODUCTS.jsu_course.margin
            emailNormReclassified++
            emailNormWarnings.push({ email_masked: email.replace(/(?<=.).(?=[^@]*@)/, '*'), amount, classification: 'jsu_course', reason: 'email_norm_join: email found in webinar_participants' })
            const k = 'jsu_course'
            if (!productAccum[k]) productAccum[k] = { productKey: k, displayName: PRODUCTS.jsu_course.displayName, orders: 0, revenue: 0, contributionMargin: PRODUCTS.jsu_course.margin, marginTotal: 0 }
            productAccum[k].orders++; productAccum[k].revenue += amount; productAccum[k].marginTotal += PRODUCTS.jsu_course.margin
          } else {
            stillUnmapped.push({ amount, product_name_raw: extractProductNameRaw(raw) ?? '—', order_date: extractOrderDate(raw), note: 'no price or name match' })
          }
        }
        unknownOrdersCount = stillUnmapped.length
        unknownRevenue = stillUnmapped.reduce((s, o) => s + o.amount, 0)
        unmappedOrders.length = 0
        for (const o of stillUnmapped) unmappedOrders.push(o)
      }
    } catch (e) {
      errors.push(`email_norm_join: ${String(e?.message ?? e)}`)
    }
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
      marginBeforeAds,
      estimatedProfitAfterAds,
      estimatedProfitPerOrder,
      productBreakdown: productBreakdownFinal,
      unmappedOrders,
      emailNormReclassified,
      emailNormWarnings: emailNormWarnings.length > 0 ? emailNormWarnings : undefined,
      sourceTable: usedOrdersTable,
      debugOrders: debug ? debugOrders : undefined,
      errors: errors.length > 0 ? errors : undefined,
    }),
  }
}
