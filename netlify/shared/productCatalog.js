// ═══════════════════════════════════════════════════════════════════════════════
// productCatalog.js — THE single source of truth for
//   · product identity (key, display name)
//   · price → product mapping
//   · scope (memory / language / other)
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
import { businessDay, businessToday, businessDaysAgo } from './businessDay.js'

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
  // COGNI IS NOT HERE, AND MUST NOT BE ADDED BACK.
  //
  // Cogni is never sold through Wix. Its revenue arrives in Stripe and only in
  // Stripe, so no `orders` row can be a Cogni sale — and an entry for it in
  // this catalog can therefore only ever mislabel something else. It did: at
  // 499 PLN it shared a price with Perfect Student Online, and until fd7551b
  // the price decided, so every PSO sale was reported as "Cogni rocznie" with
  // a 450 PLN margin it never earned.
  //
  // A matching price is NOT a reason to put it back. That is exactly the
  // evidence that produced the wrong answer last time.

  // Perfect Student Online — the Wix/Velo learning platform (CMS collection
  // PSO_Progress). Matched by NAME ONLY: 499 is deliberately absent from
  // PRICE_TO_PRODUCTS below, so an unrecognised 499 PLN order can never fall
  // into PSO the way it used to fall into Cogni.
  pso: {
    key: 'pso', displayName: 'Perfect Student Online', shortName: 'PSO',
    // Out of both ad funnels: there is no Meta campaign for PSO, so putting it
    // in `memory` or `language` would charge it with spend that never chased it.
    scope: 'other', catalogPrice: 499, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża PSO nieznana — brak w briefingu',
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
    marginUnknown: true,
    marginUnknownReason: 'marża WSZTP nieznana — obóz rozliczany poza lejkiem',
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

// Price → the products that sell at that price.
//
// THE NAME DECIDES, NOT THE PRICE. This used to be the other way round, and it
// put Perfect Student Online into Cogni because both cost 499 PLN. A Wix
// product name is edited by hand and a price is not, which is why price looked
// like the safer signal — but a price shared by two products carries no
// information at all, while a name almost always does.
//
// So: the name is tried first; the price only confirms it, or stands in when
// the name matched nothing. Where a price has MORE than one candidate and the
// name did not decide, the order goes to UNMAPPED with the collision spelled
// out — never the first candidate in the list.
//
//   99   = Pakiet Pamięciowy sold without the 20 PLN shipping line (form error)
//   1250 = WSZTP deposit · 3450 = WSZTP in full
//
// 499 IS DELIBERATELY ABSENT. Perfect Student Online sells at 499 and is
// matched by name alone. Listing it here would mean an unrecognised 499 PLN
// order resolves to PSO on the price — which is precisely the mechanism that
// turned PSO sales into "Cogni rocznie" before fd7551b, just pointed at a
// different product. A 499 PLN order whose name says nothing goes to UNMAPPED.
//
// 115 is absent for the same family of reason: both a memory row and a
// language row have sold at 115 PLN, so the price carries no signal.
export const PRICE_TO_PRODUCTS = {
  95:   ['jezykozak_pack'],
  99:   ['memory_pack'],
  114:  ['language_3t'],
  119:  ['memory_pack'],
  347:  ['jzk_ai'],
  549:  ['jsu_course'],
  1250: ['wsztp'],
  3450: ['wsztp'],
}

/**
 * The single candidate at a price, or null when there is none or more than one.
 * Kept separate from PRICE_TO_PRODUCTS so a collision can never be silently
 * resolved by taking element zero.
 */
export function soleProductAtPrice(amount) {
  const candidates = PRICE_TO_PRODUCTS[amount]
  return candidates && candidates.length === 1 ? candidates[0] : null
}

/**
 * Startup check: a price shared by two products is fine ONLY if both of them
 * can be told apart by name. Every product here must therefore own at least
 * one name pattern — otherwise a 499 PLN order with an unhelpful name would be
 * unresolvable, and the catalog would be lying about what it can distinguish.
 *
 * Called at module load. A catalog that cannot do its job should fail the
 * build, not fail quietly at runtime on one order a month.
 */
export function assertCatalogIsResolvable() {
  const named = new Set(NAME_PATTERNS.map(([key]) => key))
  const problems = []
  for (const [price, keys] of Object.entries(PRICE_TO_PRODUCTS)) {
    if (keys.length < 2) continue
    const unnameable = keys.filter(k => !named.has(k))
    if (unnameable.length > 0) {
      problems.push(`${price} PLN: ${keys.join(' / ')} share a price, and `
        + `${unnameable.join(', ')} has no name pattern — such an order could never be resolved`)
    }
  }
  if (problems.length > 0) {
    throw new Error('productCatalog: unresolvable price collision\n  ' + problems.join('\n  '))
  }
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
// ── Administrative access grants ────────────────────────────────────────────
//
// Somebody paid outside the shop — a transfer, an invoice, a bundle sold in a
// webinar — and was then let into the "Jak się uczyć" course by hand. Wix
// records that as a 1 PLN order marked Offline. It is a door being opened, not
// a transaction: no revenue, no margin, no CPA, no ROAS, no product.
//
// Until now these fell out of the dashboard because 1 PLN is under the 5 PLN
// test-order floor. The floor caught them by accident, and called them
// "odcięte progiem", which says the wrong thing: nothing was cut off, nothing
// was nearly a sale. 34 of them happened between June and October.
//
// THE AMOUNT ALONE IS NEVER ENOUGH. A real sale at a token price — a 1 PLN
// trial, a 5 PLN upsell — must not disappear into this category, so a second,
// independent condition is required on top of the amount.
export const ADMIN_ACCESS = {
  /** At or under this, in PLN. A grant is recorded at 1; the floor allows 5. */
  maxAmount: 5,
  /** The payment operator Wix stamps on a manual grant. Normalised. */
  operator: 'offline',
  /**
   * The exact product name on every one of the 34 grants seen so far.
   *
   * This is the STAND-IN for the operator, used only while `orders` has no
   * column to put an operator in — see paymentProviderKnown() below. It is an
   * exact match, not a pattern: "Kurs online Jak się uczyć" is the real course
   * at 549 PLN and must never land here.
   */
  grantName: 'jak sie uczyc',
}

/**
 * The payment operator on a row, or null when this system cannot know it.
 *
 * `orders` has ten columns and none of them is the operator
 * (supabase/migrations/20261020_payment_provider.sql adds one; it is not
 * applied, and Make does not map it yet). Null here means "unknown", which is
 * deliberately NOT the same as "not Offline".
 */
export const extractPaymentProvider = (row) =>
  row?.payment_provider ?? row?.payment_operator ?? row?.operator ?? null

const providerKnown = (provider) =>
  provider != null && String(provider).trim() !== ''

/**
 * Is this row a manual access grant rather than a sale?
 *
 * Two necessary conditions, never one. The amount gets a row considered; the
 * second condition decides, and which second condition applied is recorded in
 * the verdict so nobody has to guess later which evidence was available.
 *
 *   amount ≤ 5  +  operator Offline              → grant  (the real rule)
 *   amount ≤ 5  +  operator unknown + exact name → grant  (the stand-in)
 *   amount ≤ 5  +  exact name but operator is X  → NOT a grant, and says why
 *   amount > 5  +  operator Offline              → NOT a grant, and says why
 *   anything with neither Offline nor the exact name → not this category's
 *       business at all; it stays quiet and the ordinary classification runs
 *
 * The stand-in exists because the operator is not in the database yet and the
 * grants are. It is strictly narrower than the amount alone: it also demands
 * the exact grant name. It disappears by itself the moment Make writes the
 * operator, because then the operator is known and the first branch decides.
 *
 * What the stand-in cannot do: tell a manual grant from a genuine 1 PLN sale
 * of a product *named exactly* "Jak się uczyć" through a real payment
 * provider. That has never happened and would need both a new price point and
 * a renamed product, but it is the gap, and it closes with the migration.
 */
export function adminAccessVerdict(amount, rawName, provider) {
  const amt = Number(amount)
  const known = providerKnown(provider)
  const isOffline = known && normalizeText(provider) === ADMIN_ACCESS.operator
  const cheap = Number.isFinite(amt) && amt <= ADMIN_ACCESS.maxAmount
  const nameIsGrant = normalizeText(rawName) === ADMIN_ACCESS.grantName

  // Nothing about this row points at the category. Say nothing: the ordinary
  // classification below has a more useful message than "≤ 5 zł but not a
  // grant" would be, and an 0 PLN row with no name has no business being told
  // about a category it was never near.
  if (!isOffline && !nameIsGrant) return { grant: false, reason: null }

  if (cheap && isOffline) {
    return { grant: true, evidence: `kwota ${amt} zł ≤ ${ADMIN_ACCESS.maxAmount} + operator Offline` }
  }
  if (cheap && !known && nameIsGrant) {
    return {
      grant: true,
      evidence: `kwota ${amt} zł ≤ ${ADMIN_ACCESS.maxAmount} + nazwa dokładnie "${String(rawName).trim()}"`
        + ' (operatora nie ma w bazie — patrz 20261020_payment_provider.sql)',
    }
  }
  if (cheap && known && !isOffline) {
    return {
      grant: false,
      reason: `kwota ${amt} zł ≤ ${ADMIN_ACCESS.maxAmount}, ale operator to "${String(provider).trim()}", nie Offline `
        + '— nadanie dostępu wymaga obu warunków, więc tego nie rozstrzygam',
    }
  }
  if (!cheap && isOffline) {
    return {
      grant: false,
      reason: `operator Offline, ale kwota ${amt} zł przekracza ${ADMIN_ACCESS.maxAmount} zł `
        + '— nadanie dostępu jest zapisywane na 1 zł, więc tego nie rozstrzygam',
    }
  }
  return { grant: false, reason: null }   // nothing to do with this category
}

const NAME_PATTERNS = [
  ['wsztp',          ['wsztp', 'wakacyjna', 'treningu pamieci', 'szko a treningu']],
  // 'kurs online jak sie uczyc' is how Wix actually writes it — the old
  // 'kurs jak' never matched it, so JSU was being resolved by price alone.
  // Still requires "kurs", so a PP bundle that lists "Jak się uczyć" as a bonus
  // is not read as the course.
  ['jsu_course',     ['kurs online jak sie uczyc', 'kurs jak sie uczyc', 'kurs jak', 'jsu', 'nauka uczenia']],
  // PSO is name-only — see PRICE_TO_PRODUCTS for why 499 is not a route in.
  ['pso',            ['perfect student', 'pso']],
  // Pakiet Językozaka BEFORE Językozak AI: 'jezykozak' is a substring of
  // 'jezykozaka', so the AI patterns were swallowing the pack.
  ['jezykozak_pack', ['pakiet jezykozaka', 'jezykozaka']],
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

export function classifyAmount(amount, rawName, paymentProvider = null) {
  const amt = Number(amount)

  // ── 0. IS THIS A SALE AT ALL? ────────────────────────────────────────────
  // Asked before anything else, so no future name pattern or price entry can
  // quietly swallow a manual grant and turn an opened door into revenue.
  const admin = adminAccessVerdict(amt, rawName, paymentProvider)
  if (admin.grant) {
    return {
      productKey: null, scope: null, bucket: 'ADMIN_ACCESS', qty: 1, margin: null,
      matchedBy: admin.evidence, conflict: null, failedField: null,
      adminAccess: true,
    }
  }
  if (admin.reason) {
    return {
      productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
      matchedBy: null, conflict: null, failedField: admin.reason,
    }
  }

  const nameKey = nameMatchKey(rawName)
  const candidates = PRICE_TO_PRODUCTS[amt] ?? []

  // ── 1. THE NAME DECIDES ──────────────────────────────────────────────────
  // A name match is the strongest signal there is: it says which product was
  // bought, not merely which products cost that much. The price then either
  // agrees, or is recorded as a conflict and the NAME still wins.
  if (nameKey) {
    const priceAgrees = candidates.includes(nameKey)
    if (priceAgrees) return decide(nameKey, amt, `name + price ${amt}`, null)

    // There used to be a branch here for one product sold at two price points
    // (Cogni promo 399 / regular 499), where the name reached the family and
    // only the price could pick the member. Cogni is gone and nothing else in
    // the catalog has that shape, so the branch was unreachable and is
    // removed rather than kept as scenery. If a product ever does sell at two
    // prices under one name, this is where that exception belongs — and it
    // belongs listed explicitly, never inferred.

    // The name wins and the disagreement is recorded, not resolved
    // in the price's favour. A Wix name is edited by hand but it still says
    // which product was bought; a price shared by two products does not.
    const conflict = candidates.length > 0
      ? { priceProduct: candidates[0], priceAmount: amt, nameProduct: nameKey }
      : null
    return decide(nameKey, amt, 'name', conflict)
  }

  // ── 2. THE PRICE STANDS IN, but only when it is unambiguous ──────────────
  const sole = soleProductAtPrice(amt)
  if (sole) {
    return decide(sole, amt, 'amount', null)
  }

  // ── 3. A SHARED PRICE AND NO NAME IS NOT A GUESS ─────────────────────────
  if (candidates.length > 1) {
    const names = candidates.map(k => PRODUCTS[k].displayName).join(', ')
    return {
      productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
      matchedBy: null, conflict: null,
      failedField: `kolizja ceny: ${amt} PLN pasuje do ${candidates.length} produktów `
        + `(${names}), a nazwa "${String(rawName ?? '').slice(0, 40)}" nie rozstrzygnęła`,
      priceCollision: candidates,
    }
  }

  // ── 4. nothing matched ───────────────────────────────────────────────────
  return {
    productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
    matchedBy: null, conflict: null,
    failedField: normalizeText(rawName)
      ? `amount (${amt} PLN not in PRICE_TO_PRODUCTS) + product_name_raw (no pattern match)`
      : `amount (${amt} PLN not in PRICE_TO_PRODUCTS) + product_name_raw (empty)`,
  }
}

/**
 * Turn a settled product key into a verdict: excluded, margin-less, mapped, or
 * ambiguous on quantity. Shared by the name path and the price path so the two
 * cannot drift.
 */
function decide(key, amt, matchedBy, conflict) {
  const p = PRODUCTS[key]

  if (p.excludeFromBlendedProfit) {
    return { productKey: key, scope: p.scope, bucket: 'EXCLUDED', qty: 1, margin: null,
             matchedBy, conflict, failedField: null,
             excludedReason: 'off the ad funnel — kept out of blended profit, CPA and ROAS' }
  }
  if (p.contributionMargin == null) {
    // The gap is named by the product, not by a generic string. "marża PSO
    // nieznana — brak w briefingu" tells somebody what to go and ask for;
    // "contributionMargin (not in catalog)" tells them the shape of a bug.
    return { productKey: key, scope: p.scope, bucket: 'UNKNOWN_MARGIN', qty: 1, margin: null,
             matchedBy, conflict,
             failedField: p.marginUnknownReason ?? 'contributionMargin (not in catalog)' }
  }

  const cost = unitCostOf(key)

  // At the catalog price the authoritative margin is used verbatim.
  if (amt === p.catalogPrice) {
    return { productKey: key, scope: p.scope, bucket: 'MAPPED', qty: 1,
             margin: p.contributionMargin, matchedBy, conflict, failedField: null }
  }
  // Below it → one discounted unit. Never inflated to a multiple.
  if (amt < p.catalogPrice) {
    return { productKey: key, scope: p.scope, bucket: 'MAPPED', qty: 1,
             margin: amt - cost, matchedBy: `${matchedBy} (below catalog)`, conflict, failedField: null }
  }
  // Above it → a whole multiple within tolerance, or the quantity is unclear.
  const qty = Math.round(amt / p.catalogPrice)
  if (qty >= 1 && Math.abs(amt - qty * p.catalogPrice) < QTY_TOLERANCE * (qty * p.catalogPrice)) {
    return { productKey: key, scope: p.scope, bucket: 'MAPPED', qty,
             margin: amt - cost * qty, matchedBy: `${matchedBy} ×${qty}`, conflict, failedField: null }
  }
  return {
    productKey: key, scope: p.scope, bucket: 'AMBIGUOUS', qty: null, margin: null,
    minMargin: amt - cost * Math.ceil(amt / p.catalogPrice),
    matchedBy, conflict,
    failedField: `quantity (${amt} PLN is no whole multiple of ${p.catalogPrice} within 15%)`,
  }
}

// ── Row field extraction ─────────────────────────────────────────────────────

// The business day is defined once, in ./businessDay.js. This name is kept
// because the whole module and its callers speak of order dates this way.
export const toWarsawDate = businessDay

export const warsawToday = businessToday

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
      // Null until Make maps it; adminAccessVerdict() treats null as unknown
      // rather than as "not Offline".
      paymentProvider: extractPaymentProvider(first),
      lineCount: lines.length,
      shippingLineCount: shippingLines.length,
      raw: kept,
    })
  }
  return orders
}

/** Classify an aggregated order (from aggregateOrders). */
export function classifyOrder(order) {
  return classifyAmount(order.productAmount, order.productNameRaw, order.paymentProvider)
}

// ── Supabase reads ───────────────────────────────────────────────────────────
// Every read goes through readTable() in ./supabaseRead.js, which refuses to run
// without an explicit order column and pages past PostgREST's silent 1000-row
// cap. See that file for why this is not optional.

const padDays = (iso, days) => businessDaysAgo(-days, iso)

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

/**
 * Startup check: every product states its margin, or states that it does not
 * know it.
 *
 * A null `contributionMargin` with nothing beside it is ambiguous — it could
 * mean "nobody has worked it out yet" or "somebody deleted a number by
 * accident", and the two want opposite responses. Requiring the explicit flag
 * makes the first case a decision on the record and the second case a build
 * failure.
 *
 * It also stops the quiet repair: faced with a null margin and no explanation,
 * the tempting fix is to put a plausible number in. An entry that has to carry
 * a REASON is much harder to paper over.
 */
export function assertCatalogIsComplete() {
  const problems = []
  for (const [key, p] of Object.entries(PRODUCTS)) {
    const hasNumber = typeof p.contributionMargin === 'number' && Number.isFinite(p.contributionMargin)
    if (hasNumber) {
      if (p.marginUnknown) problems.push(`${key}: has a margin AND marginUnknown — pick one`)
      continue
    }
    if (!p.marginUnknown) {
      problems.push(`${key}: contributionMargin is not a number and marginUnknown is not set `
        + '— say which, do not leave it blank')
    } else if (!p.marginUnknownReason) {
      problems.push(`${key}: marginUnknown with no marginUnknownReason — name the gap`)
    }
  }
  if (problems.length > 0) {
    throw new Error('productCatalog: incomplete entry\n  ' + problems.join('\n  '))
  }
}

// The catalog checks itself on load. A price shared by products that cannot be
// told apart by name, or an entry that neither states its margin nor admits it
// does not know it, is a build failure rather than a runtime surprise.
assertCatalogIsResolvable()
assertCatalogIsComplete()
