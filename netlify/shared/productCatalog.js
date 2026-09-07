// ═══════════════════════════════════════════════════════════════════════════════
// productCatalog.js — THE single source of truth for
//   · product identity (key, display name)
//   · price → product mapping
//   · scope (memory / language / cogni)
//   · contribution margin (PLN per unit, before ad spend)
//   · order-row → product classification
//   · reading orders out of Supabase WITHOUT truncation
//
// Nothing else in this repo may define a price, a margin, a scope or a
// classification rule. profit-data.js, orders-data.js and product-sales.js all
// import from here. There is no fallback copy anywhere — if a number is wrong,
// it is wrong in exactly one place.
//
// WHY THE FETCH LIVES HERE TOO
// ---------------------------------------------------------------------------
// The bug this module was written to kill was NOT a classification bug. Both
// profit-data.js and orders-data.js asked PostgREST for `select=*&limit=5000`
// on `orders` with no `order=` clause and no date filter. PostgREST caps a
// response at 1000 rows and, without ORDER BY, returns them in physical
// (oldest-first) order. Once `orders` passed 1000 rows every newer order became
// invisible: margin was computed over an empty set, so Est. Profit collapsed to
// exactly −(ad spend) and the PP counter to 0. Fetching is therefore part of the
// contract, not an implementation detail of each caller.
// ═══════════════════════════════════════════════════════════════════════════════

import { readTable } from './supabaseRead.js'

// ── Catalog ──────────────────────────────────────────────────────────────────
// `contributionMargin` is the AUTHORITATIVE margin at `catalogPrice`.
// `null` means "not known" — never 0, never guessed. A product with a null
// margin still gets named and counted; its margin is excluded from profit and
// reported as a hole.
export const PRODUCTS = {
  memory_pack: {
    key: 'memory_pack', displayName: 'Pakiet Pamięciowy', shortName: 'PP',
    scope: 'memory', catalogPrice: 119, contributionMargin: 70,
  },
  language_3t: {
    key: 'language_3t', displayName: 'Pakiet Językowy 3T', shortName: '3T',
    scope: 'language', catalogPrice: 114, contributionMargin: 55,
  },
  jezykozak_pack: {
    key: 'jezykozak_pack', displayName: 'Pakiet Językozaka', shortName: 'PJ',
    scope: 'language', catalogPrice: 95, contributionMargin: 88,
  },
  jzk_ai: {
    key: 'jzk_ai', displayName: 'Językozak AI', shortName: 'JZK AI',
    scope: 'language', catalogPrice: 347, contributionMargin: 320,
  },
  jsu_course: {
    key: 'jsu_course', displayName: 'Kurs Jak się uczyć', shortName: 'JSU',
    scope: 'memory', catalogPrice: 549, contributionMargin: 500,
  },
  // Cogni annual sells at two prices with two different margins, so it is two
  // catalog entries. One entry cannot carry two margins without one of them
  // being derived — i.e. invented.
  cogni_promo: {
    key: 'cogni_promo', displayName: 'Cogni rocznie (promo)', shortName: 'Cogni promo',
    scope: 'cogni', catalogPrice: 399, contributionMargin: 355,
  },
  cogni_regular: {
    key: 'cogni_regular', displayName: 'Cogni rocznie', shortName: 'Cogni',
    scope: 'cogni', catalogPrice: 499, contributionMargin: 450,
  },
  // WSZTP — Wakacyjna Szkoła Treningu Pamięci. Deposit 1250 / full 3450.
  //
  // Its margin is genuinely unknown, so it stays null. But it is ALSO excluded
  // from every blended figure, and that is a separate decision from the missing
  // margin: the camp is cut off from the ad funnel, so its orders are not what
  // the Meta spend bought. One 3450 PLN order lands in a day whose ad spend is
  // ~500 PLN and drags that day's blended CPA and ROAS somewhere fictional.
  // Excluded from Est. Profit, Real CPA and Real ROAS; reported on its own line.
  wsztp: {
    key: 'wsztp', displayName: 'WSZTP', shortName: 'WSZTP',
    scope: 'memory', catalogPrice: 3450, contributionMargin: null,
    excludeFromBlendedProfit: true,
  },
}

/** True for products deliberately kept out of every blended profit/CPA/ROAS figure. */
export function isExcludedFromBlended(productKey) {
  return PRODUCTS[productKey]?.excludeFromBlendedProfit === true
}

// Unit cost is DERIVED from the authoritative margin at the catalog price, so
// there is one number to maintain per product, not two. It is only used to price
// an off-catalog amount (a discount, a bundle) honestly.
export function unitCostOf(productKey) {
  const p = PRODUCTS[productKey]
  if (!p || p.contributionMargin == null) return null
  return p.catalogPrice - p.contributionMargin
}

// Price → product. AUTHORITATIVE; price beats the product name, because Wix
// product names are edited freely by hand while the price is what was charged.
//   99   = Pakiet Pamięciowy sold without the 20 PLN shipping line (form error)
//   1250 = WSZTP deposit · 3450 = WSZTP in full
//   399  = Cogni annual on promo · 499 = Cogni annual at the regular price
// 115 is deliberately ABSENT: both a memory row and a language row have sold at
// 115 PLN, so the price carries no signal there and the name decides.
export const PRICE_TO_PRODUCT = {
  95:   'jezykozak_pack',
  99:   'memory_pack',
  114:  'language_3t',
  119:  'memory_pack',
  347:  'jzk_ai',
  399:  'cogni_promo',
  499:  'cogni_regular',
  549:  'jsu_course',
  1250: 'wsztp',
  3450: 'wsztp',
}

// ── Text handling ────────────────────────────────────────────────────────────

export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const anyMatch = (norm, patterns) => patterns.some(p => norm.includes(p))

// A Wix order carries its shipping/handling as a separate line. It is not a
// product: it must not be classified, and its value must not earn a margin.
export const SHIPPING_PATTERNS = [
  'wysylka ubezpieczenie paczka', 'wysylka', 'przesylka', 'dostawa',
  'ubezpieczenie', 'paczka', 'shipping', 'handling',
]
export function isShippingLine(rawName) {
  const norm = normalizeText(rawName)
  return norm.length > 0 && anyMatch(norm, SHIPPING_PATTERNS)
}

// Name patterns — the SECONDARY signal, used when the amount is not a catalog
// price. Deliberately narrow.
//   · JSU requires "kurs", so a PP bundle that merely lists "Jak się uczyć" as
//     a bonus is never read as the JSU course.
//   · WSZTP is matched before the broad 'pamiec' pattern so the high-ticket
//     product never inherits the PP margin.
const NAME_PATTERNS = [
  ['wsztp',          ['wsztp', 'wakacyjna', 'treningu pamieci', 'szko a treningu']],
  ['jsu_course',     ['kurs jak sie uczyc', 'kurs jak', 'jsu', 'nauka uczenia']],
  ['cogni_regular',  ['cogni']],
  ['jzk_ai',         ['jezykozak ai', 'jezykozak', 'jzk', 'nauka jezykow', 'nauka jezyk']],
  ['language_3t',    ['pakiet jezykowy', 'jezykowy', 'zadziwiajace techniki', 'techniki nauki jezyk', '3 zadziwiajace']],
  ['memory_pack',    ['pakiet pamieciowy', 'trening pamiec', 'trening interaktywny', 'super pamiec', 'pamiec', 'memory pack']],
]

export function nameMatchKey(rawName) {
  const norm = normalizeText(rawName)
  if (!norm) return null
  for (const [key, patterns] of NAME_PATTERNS) {
    if (anyMatch(norm, patterns)) return key
  }
  return null
}

// ── Classification ───────────────────────────────────────────────────────────
// Buckets, and what each one means for the blended figures:
//   MAPPED         — product known, margin known      → counts toward profit
//   EXCLUDED       — product known, deliberately OUT   → WSZTP; own line, no margin
//   UNKNOWN_MARGIN — product known, margin unknown     → named, margin missing
//   AMBIGUOUS      — product known, quantity unclear   → lower bound only
//   UNMAPPED       — nothing matched at all            → nothing known
//
// EXCLUDED and UNMAPPED are NOT the same state and must never be shown as one
// number. EXCLUDED is a decision we made on purpose (the camp is off the ad
// funnel); UNMAPPED is a gap in the catalog that somebody has to go and close.
// `matchedBy` and `failedField` are always populated so a hole can be explained
// by the field it broke on rather than by a shrug.
const QTY_TOLERANCE = 0.15   // within 15% of a whole multiple of the catalog price

export function classifyAmount(amount, rawName) {
  const amt = Number(amount)
  const nameKey = nameMatchKey(rawName)

  // 1 — exact catalog price wins over the name.
  const priceKey = Object.prototype.hasOwnProperty.call(PRICE_TO_PRODUCT, amt)
    ? PRICE_TO_PRODUCT[amt]
    : null

  if (priceKey) {
    const p = PRODUCTS[priceKey]
    const conflict = nameKey && nameKey !== priceKey
      ? { priceProduct: priceKey, priceAmount: amt, nameProduct: nameKey }
      : null
    if (p.excludeFromBlendedProfit) {
      return { productKey: priceKey, scope: p.scope, bucket: 'EXCLUDED', qty: 1, margin: null, matchedBy: `price ${amt}`, conflict, failedField: null, excludedReason: 'off the ad funnel — kept out of blended profit, CPA and ROAS' }
    }
    if (p.contributionMargin == null) {
      return { productKey: priceKey, scope: p.scope, bucket: 'UNKNOWN_MARGIN', qty: 1, margin: null, matchedBy: `price ${amt}`, conflict, failedField: 'contributionMargin (not in catalog)' }
    }
    // At the catalog price the authoritative margin is used verbatim; away from
    // it the margin is the amount actually charged minus the derived unit cost.
    const margin = amt === p.catalogPrice ? p.contributionMargin : amt - unitCostOf(priceKey)
    return { productKey: priceKey, scope: p.scope, bucket: 'MAPPED', qty: 1, margin, matchedBy: `price ${amt}`, conflict, failedField: null }
  }

  // 2 — name-matched product at a non-catalog amount.
  if (nameKey) {
    const p = PRODUCTS[nameKey]
    if (p.excludeFromBlendedProfit) {
      return { productKey: nameKey, scope: p.scope, bucket: 'EXCLUDED', qty: 1, margin: null, matchedBy: 'name', conflict: null, failedField: null, excludedReason: 'off the ad funnel — kept out of blended profit, CPA and ROAS' }
    }
    if (p.contributionMargin == null) {
      return { productKey: nameKey, scope: p.scope, bucket: 'UNKNOWN_MARGIN', qty: 1, margin: null, matchedBy: 'name', conflict: null, failedField: 'contributionMargin (not in catalog)' }
    }
    const cost = unitCostOf(nameKey)
    // Below the catalog price → one discounted unit. Never inflated to a multiple.
    if (amt < p.catalogPrice) {
      return { productKey: nameKey, scope: p.scope, bucket: 'MAPPED', qty: 1, margin: amt - cost, matchedBy: 'name (below catalog)', conflict: null, failedField: null }
    }
    const qty = Math.round(amt / p.catalogPrice)
    if (qty >= 1 && Math.abs(amt - qty * p.catalogPrice) < QTY_TOLERANCE * (qty * p.catalogPrice)) {
      return { productKey: nameKey, scope: p.scope, bucket: 'MAPPED', qty, margin: amt - cost * qty, matchedBy: `name ×${qty}`, conflict: null, failedField: null }
    }
    return {
      productKey: nameKey, scope: p.scope, bucket: 'AMBIGUOUS', qty: null, margin: null,
      minMargin: amt - cost * Math.ceil(amt / p.catalogPrice),
      matchedBy: 'name', conflict: null,
      failedField: `quantity (${amt} PLN is no whole multiple of ${p.catalogPrice} within 15%)`,
    }
  }

  // 3 — nothing matched.
  return {
    productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
    matchedBy: null, conflict: null,
    failedField: normalizeText(rawName)
      ? `amount (${amt} PLN not in PRICE_TO_PRODUCT) + product_name_raw (no pattern match)`
      : `amount (${amt} PLN not in PRICE_TO_PRODUCT) + product_name_raw (empty)`,
  }
}

// ── Row field extraction ─────────────────────────────────────────────────────

export function toWarsawDate(val) {
  if (val == null) return ''
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) }
  catch { return s.slice(0, 10) }
}

export const warsawToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

export const extractOrderDate = (row) =>
  toWarsawDate(row.order_created_at ?? row.order_date ?? row.created_at ?? row.date ?? row.created ?? '')

export const extractOrderId = (row) =>
  String(row.external_order_id ?? row.order_id ?? row.id ?? '')

export const extractProductNameRaw = (row) =>
  row.product_name_raw ?? row.product_name ?? row.item_name ?? row.product_title ?? null

export function extractAmount(row) {
  for (const c of [row.amount, row.total, row.price, row.revenue, row.order_total, row.price_total, row.total_price]) {
    const n = Number(c)
    if (!isNaN(n) && n > 0) return n
  }
  return 0
}

export function extractEmail(row) {
  const raw = String(row.buyer_email ?? row.email ?? row.customer_email ?? row.contact_email ?? '').trim().toLowerCase()
  const m = raw.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/)
  return m ? m[0] : ''
}

export function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***'
  const [local, domain] = email.split('@')
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`
}

// ── Aggregation: rows → orders ───────────────────────────────────────────────
// Classification runs on the WHOLE order, never on a single line. If the ingest
// ever starts writing one row per Wix line item (99 PLN product + 20 PLN
// "Wysyłka + Ubezpieczenie + Paczka"), the product lines are summed and the
// shipping line is dropped from both the classification and the margin.
//
// A shipping line is only dropped when the same order also has a product line —
// otherwise a lone row whose name happens to mention "paczka" would delete a
// real order.
export function aggregateOrders(rows) {
  const byId = new Map()
  let seq = 0
  for (const row of rows) {
    const id = extractOrderId(row) || `__row_${seq++}`
    if (!byId.has(id)) byId.set(id, [])
    byId.get(id).push(row)
  }

  const orders = []
  for (const [orderId, lines] of byId) {
    const productLines = lines.filter(r => !isShippingLine(extractProductNameRaw(r)))
    const shippingLines = lines.filter(r => isShippingLine(extractProductNameRaw(r)))
    // Keep shipping lines only if dropping them would empty the order.
    const kept = productLines.length > 0 ? productLines : lines
    const shippingAmount = productLines.length > 0
      ? shippingLines.reduce((s, r) => s + extractAmount(r), 0)
      : 0

    const productAmount = kept.reduce((s, r) => s + extractAmount(r), 0)
    const first = kept[0]
    orders.push({
      orderId,
      orderDate: extractOrderDate(first),
      // Revenue is everything the customer paid, shipping included — it must
      // still reconcile with wix_revenue. Classification uses productAmount.
      revenue: productAmount + shippingAmount,
      productAmount,
      shippingAmount,
      productNameRaw: kept.map(r => extractProductNameRaw(r)).filter(Boolean).join(' + ') || null,
      email: extractEmail(first),
      lineCount: lines.length,
      shippingLineCount: shippingLines.length,
      raw: kept,
    })
  }
  return orders
}

/** Classify an aggregated order (from aggregateOrders). */
export function classifyOrder(order) {
  return classifyAmount(order.productAmount, order.productNameRaw)
}

// ── Supabase reads ───────────────────────────────────────────────────────────
// Every read goes through readTable() in ./supabaseRead.js, which refuses to run
// without an explicit order column and pages past PostgREST's silent 1000-row
// cap. See that file for why this is not optional.

const padDays = (iso, days) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

/**
 * Does this row belong in the counted set?
 *
 * v_daily_wix_meta_performance — the view the whole dashboard quotes for Wix
 * orders and revenue — counts `orders` rows WHERE source = 'wix' AND
 * lower(payment_status) = 'paid' AND external_order_id NOT ILIKE 'TEST-%' AND
 * email NOT ILIKE '%test%'. profit-data has to apply the SAME predicate or its
 * order count can never reconcile with the card next to it.
 *
 * Each condition is skipped when the column is absent from the row, so the
 * `wix_orders` fallback table (which has a different shape) still works. That is
 * a shape difference, not a filter that quietly lets junk in: a row missing
 * `payment_status` cannot be judged on it.
 */
export function isCountableOrder(row) {
  if ('source' in row && row.source != null && String(row.source).toLowerCase() !== 'wix') return false
  if ('payment_status' in row && row.payment_status != null && String(row.payment_status).toLowerCase() !== 'paid') return false
  const extId = row.external_order_id
  if (extId != null && /^test-/i.test(String(extId))) return false
  const email = String(row.email ?? row.buyer_email ?? '')
  if (email && /test/i.test(email)) return false
  return true
}

/**
 * Orders whose Warsaw calendar date falls in [from, to] inclusive, filtered to
 * the same set the daily view counts.
 *
 * The server-side date filter is widened by a day on each side because
 * order_created_at is a UTC timestamp while [from, to] is Warsaw-local; the
 * exact boundary is then applied in JS through toWarsawDate. Rows with a NULL
 * order_created_at are read separately so they can still be dated from their
 * fallback columns instead of silently disappearing.
 */
export async function fetchOrdersInRange(supabaseUrl, serviceKey, table, from, to) {
  const dated = await readTable(supabaseUrl, serviceKey, table, {
    select: '*',
    order:  'order_created_at.desc',
    filters: { order_created_at: [`gte.${padDays(from, -1)}`, `lte.${padDays(to, 1)}T23:59:59`] },
  })
  const undated = await readTable(supabaseUrl, serviceKey, table, {
    select: '*',
    order:  'external_order_id.asc',
    filters: { order_created_at: 'is.null' },
  })
  return [...dated, ...undated].filter(row => {
    if (!isCountableOrder(row)) return false
    const d = extractOrderDate(row)
    return d >= from && d <= to
  })
}

/** Every countable order row in the table, newest first, across every page. */
export async function fetchAllOrders(supabaseUrl, serviceKey, table) {
  const rows = await readTable(supabaseUrl, serviceKey, table, {
    select: '*',
    order:  'order_created_at.desc.nullslast',
  })
  return rows.filter(isCountableOrder)
}
