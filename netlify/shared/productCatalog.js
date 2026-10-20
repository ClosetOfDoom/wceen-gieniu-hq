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
  // ── Pozycje z landingów i webinarów (marże ustalone) ────────────────────
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

  // ── Sklep eccehomo21.com/shop (marże nieustalone) ───────────────────────
  szurawski_pack: {
    key: 'szurawski_pack', displayName: 'Pakiet szkoleń Marka Szurawskiego', shortName: 'Szurawski',
    scope: 'other', catalogPrice: 499, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  hi_memory: {
    key: 'hi_memory', displayName: 'Hi Memory! Ucz się i baw.', shortName: 'Hi Memory',
    scope: 'other', catalogPrice: 420, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  memory_training: {
    key: 'memory_training', displayName: 'Pamięć. Trening interaktywny', shortName: 'PTI',
    scope: 'memory', catalogPrice: 95, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  memory_training_pdf: {
    key: 'memory_training_pdf', displayName: 'Pamięć. Trening interaktywny (PDF)', shortName: 'PTI PDF',
    scope: 'memory', catalogPrice: 75, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  lang_3t_single: {
    key: 'lang_3t_single', displayName: '3 zadziwiające techniki nauki języków', shortName: '3T solo',
    scope: 'language', catalogPrice: 95, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  lang_3t_pdf: {
    key: 'lang_3t_pdf', displayName: '3 Zadziwiające Techniki Nauki Języków (PDF)', shortName: '3T PDF',
    scope: 'language', catalogPrice: 60, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  slowoszyt_pdf: {
    key: 'slowoszyt_pdf', displayName: 'Słowoszyt (PDF)', shortName: 'Słowoszyt',
    scope: 'other', catalogPrice: 90, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  jsu_book: {
    key: 'jsu_book', displayName: 'Jak się uczyć', shortName: 'JSU książka',
    scope: 'memory', catalogPrice: 80, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  jsu_pdf: {
    key: 'jsu_pdf', displayName: 'Jak się uczyć (PDF)', shortName: 'JSU PDF',
    scope: 'memory', catalogPrice: 60, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_historie: {
    key: 'book_historie', displayName: 'Historie, które zostają', shortName: 'Historie',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_mysz: {
    key: 'book_mysz', displayName: 'Opowieść o skaczącej myszy', shortName: 'Skacząca mysz',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_ptaki: {
    key: 'book_ptaki', displayName: 'Jak zapamiętywać głosy ptaków', shortName: 'Głosy ptaków',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_mysli_chlopiec: {
    key: 'book_mysli_chlopiec', displayName: 'Bądź dobrej myśli (dla chłopca)', shortName: 'Dobrej myśli ch.',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_mysli_dziewczynka: {
    key: 'book_mysli_dziewczynka', displayName: 'Bądź dobrej myśli (dla dziewczynki)', shortName: 'Dobrej myśli dz.',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  techniki_przywolujace: {
    key: 'techniki_przywolujace', displayName: 'Techniki przywołujące', shortName: 'Techniki przyw.',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  test_iwm: {
    key: 'test_iwm', displayName: 'Test na rozpoznanie Indywidualnych Wzorców Myślenia', shortName: 'Test IWM',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },
  book_8020: {
    key: 'book_8020', displayName: '80/20, Zasada która ukształtowała świat', shortName: '80/20',
    scope: 'other', catalogPrice: 50, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża nieustalona — czeka na dane od właściciela',
  },

  // ── Poza lejkami ─────────────────────────────────────────────────────────
  pso: {
    key: 'pso', displayName: 'Perfect Student Online', shortName: 'PSO',
    scope: 'other', catalogPrice: 499, contributionMargin: null,
    marginUnknown: true,
    marginUnknownReason: 'marża PSO nieznana — brak w briefingu',
  },
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

// THE PRICE NEVER PICKS A PRODUCT. There is no price→product map here, and
// that is deliberate: there used to be one, and every bug it caused was the
// same bug. 499 PLN was Cogni and Perfect Student Online; now the catalog
// holds EIGHT products at 50 PLN, three at 95, two at 499, two at 60, plus
// 119 and 114 from the landing pages sitting next to 470 and 94 from the
// shop. A price is not evidence of anything.
//
// catalogPrice stays on each entry, used for ONE thing: spotting that
// something sold below its listed price (the RABATY I ODCHYLENIA section).
// It is never consulted to decide WHAT sold.
//
// So the name is the only key. No name match → UNMAPPED, carrying the raw Wix
// name so a human can see exactly what arrived.

// ── Text handling ────────────────────────────────────────────────────────────

/**
 * The ONE normalisation. Everything that compares a product name — the card,
 * the COPY report, Q&A, the catalog itself — goes through this, so a name can
 * never mean two things in two places.
 *
 * Flattens case, accents, dashes of every width, brackets, punctuation and
 * doubled spaces, so "HISTORIE, KTÓRE ZOSTAJĄ – 50 opowieści" and
 * "historie   ktore zostaja" come out identical.
 *
 * Ł IS FOLDED TO L EXPLICITLY. Unicode NFD does not decompose ł — it is a
 * single codepoint, not l plus a diacritic — so the catch-all below used to
 * turn it into a SPACE: "głosy" became "g osy", "Słowoszyt" became "s owoszyt"
 * and "Szkoła" became "szko a". Three patterns silently matched nothing, and
 * an older pattern in this file had been written as 'szko a treningu' to work
 * around it rather than fix it. One line here, instead of a trap in every
 * Polish product name that happens to contain an ł.
 */
export function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
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
// ── Rows that are not sales ─────────────────────────────────────────────────
//
// Three different things arrive in `orders` that nobody bought, and each one
// used to be mishandled in its own way:
//
//   KOSZYK PUSTY (0 PLN) — the customer unticked the book line in the Wix
//       form. Nothing shipped, nothing cost anything. The classifier used to
//       match these to Pakiet Pamięciowy on the name and then compute
//       margin = 0 − 49, so two empty carts were quietly removing 98 PLN from
//       Est. Profit. There is no cost to deduct: a cart that was emptied did
//       not consume a book.
//
//   LEAD MAGNET (0 PLN, name starts with "GRATIS:") — a free download. Also
//       not a sale, but a different mechanism, so it gets its own line rather
//       than being averaged into the carts.
//
//   DOSTĘP ADMINISTRACYJNY (≤5 PLN, operator Offline) — somebody paid outside
//       the shop and was let into the course by hand.
//
// ALL THREE ARE RECOGNISED HERE, BY ONE FUNCTION. They were heading towards
// three conditions in three files, which is how the dashboard and Stanley end
// up disagreeing about what a row is.
//
// None of them has revenue, cost or margin — in either direction. A zero
// margin is not "earned nothing", it is "was never a transaction".
export const NON_SALE = {
  /** A grant is recorded at 1 PLN; the dashboard's test-order floor is 5. */
  adminMaxAmount: 5,
  /** The payment operator Wix stamps on a manual grant. Normalised. */
  adminOperator: 'offline',
  /**
   * The exact product name on every grant seen so far. This is the STAND-IN
   * for the operator, used only while `orders` has no column to hold one —
   * see 20261020_payment_provider.sql. Matched exactly, so the real 549 PLN
   * course ("Kurs online Jak się uczyć") never lands here.
   */
  adminGrantName: 'jak sie uczyc',
  /** A free download announces itself in the product name. */
  leadMagnetPrefix: 'gratis',
}

/** Human labels, in one place, so the card, COPY and Q&A say the same thing. */
export const NON_SALE_LABELS = {
  empty_cart:   'Koszyki 0 zł',
  lead_magnet:  'Lead magnety',
  admin_access: 'Dostęp administracyjny',
}

/**
 * The payment operator on a row, or null when this system cannot know it.
 *
 * `orders` has no operator column yet (20261020_payment_provider.sql adds
 * one). Null means UNKNOWN, which is deliberately NOT the same as
 * "not Offline".
 */
export const extractPaymentProvider = (row) =>
  row?.payment_provider ?? row?.payment_operator ?? row?.operator ?? null

const providerKnown = (provider) =>
  provider != null && String(provider).trim() !== ''

/**
 * Is this row a sale at all?
 *
 * @returns {{category: string, evidence: string}} when it is not a sale,
 *          {{category: null, reason: string|null}} otherwise. A non-null
 *          `reason` means "this looked like a non-sale and is not one, and
 *          here is why" — those go to UNMAPPED rather than being guessed at.
 *
 * ZERO IS CHECKED FIRST, before the grant rules, because 0 ≤ 5 and a 0 PLN
 * row marked Offline would otherwise read as a grant. Grants are recorded at
 * 1 PLN; 0 PLN is an emptied cart.
 *
 * The grant rules need TWO conditions, never the amount alone, so a genuine
 * sale at a token price cannot vanish in here:
 *
 *   ≤5 PLN + operator Offline              → grant  (the real rule)
 *   ≤5 PLN + operator unknown + exact name → grant  (the stand-in)
 *   ≤5 PLN + exact name but operator is X  → NOT a grant, and says why
 *   >5 PLN + operator Offline              → NOT a grant, and says why
 *   neither Offline nor the exact name     → not this function's business;
 *       it stays quiet and the ordinary classification keeps its own message
 */
export function nonSaleVerdict(amount, rawName, provider) {
  const amt = Number(amount)
  const name = normalizeText(rawName)

  // ── 0 PLN: nothing was bought, whichever way it got here ────────────────
  if (Number.isFinite(amt) && amt === 0) {
    if (name.startsWith(NON_SALE.leadMagnetPrefix)) {
      return { category: 'lead_magnet', evidence: `0 zł + nazwa zaczyna się od "GRATIS:"` }
    }
    return {
      category: 'empty_cart',
      evidence: '0 zł — pozycja odznaczona w formularzu Wix, nic nie wysłano',
    }
  }

  // ── manual access grants ────────────────────────────────────────────────
  const known = providerKnown(provider)
  const isOffline = known && normalizeText(provider) === NON_SALE.adminOperator
  const cheap = Number.isFinite(amt) && amt <= NON_SALE.adminMaxAmount
  const nameIsGrant = name === NON_SALE.adminGrantName

  if (!isOffline && !nameIsGrant) return { category: null, reason: null }

  if (cheap && isOffline) {
    return {
      category: 'admin_access',
      evidence: `kwota ${amt} zł ≤ ${NON_SALE.adminMaxAmount} + operator Offline`,
    }
  }
  if (cheap && !known && nameIsGrant) {
    return {
      category: 'admin_access',
      evidence: `kwota ${amt} zł ≤ ${NON_SALE.adminMaxAmount} + nazwa dokładnie "${String(rawName).trim()}"`
        + ' (operatora nie ma w bazie — patrz 20261020_payment_provider.sql)',
    }
  }
  if (cheap && known && !isOffline) {
    return {
      category: null,
      reason: `kwota ${amt} zł ≤ ${NON_SALE.adminMaxAmount}, ale operator to "${String(provider).trim()}", `
        + 'nie Offline — nadanie dostępu wymaga obu warunków, więc tego nie rozstrzygam',
    }
  }
  if (!cheap && isOffline) {
    return {
      category: null,
      reason: `operator Offline, ale kwota ${amt} zł przekracza ${NON_SALE.adminMaxAmount} zł `
        + '— nadanie dostępu jest zapisywane na 1 zł, więc tego nie rozstrzygam',
    }
  }
  return { category: null, reason: null }
}

// Name → product. LONGEST MATCHING PATTERN WINS, which is what lets a variant
// beat the product it is a variant of.
//
// "Jak się uczyć" (80 PLN book) and "Jak się uczyć (PDF)" (60 PLN) differ by
// three characters, and plain substring matching would read every PDF sale as
// the book, because the book's name is contained in the PDF's. Ranking by
// matched length fixes that without special cases: 'jak sie uczyc pdf' is
// longer than 'jak sie uczyc', so it wins whenever it is present.
//
// Order in this list does NOT decide anything any more — length does. The list
// is grouped for reading only.
//
// THREE SHOP LISTINGS HAVE NO ENTRY OF THEIR OWN, ON PURPOSE:
//   470 "Pakiet Pamięciowy – Pamięć + bonusy (…)" — 39 orders carry this exact
//       name and 37 of them sold at 119, not 470. Giving it a separate entry
//       with an unknown margin would move 4 641 PLN of revenue off a KNOWN
//       margin of 70/unit and cut Est. Profit by 2 730 PLN on the strength of
//       a price list that the orders contradict.
//    94 "3 Zadziwiające Techniki Nauki Języków - Pakiet Językowy" — sells at
//       114 (30 orders) and 99,90 (12). Same situation.
//    95 "3 zadziwiające techniki nauki języków" — sells at 115.
// All three resolve to the existing entry whose margin is established. The
// shop prices are reported as an open question rather than silently adopted.
const NAME_PATTERNS = [
  // ── established margins ────────────────────────────────────────────────
  // The long patterns here are what keep the shop's shorter listings from
  // stealing these orders: 'pamiec trening interaktywny ebook druk' (38) beats
  // 'pamiec trening interaktywny' (27).
  ['memory_pack',     ['pamiec trening interaktywny ebook druk',
                       'pakiet pamieciowy pamiec bonusy',
                       'pakiet pamieciowy']],
  ['language_3t',     ['3 zadziwiajace techniki nauki jezykow pakiet jezykowy',
                       'zadziwiajace techniki nauki jezykow druk ebook',
                       'pakiet jezykowy']],
  ['jezykozak_pack',  ['pakiet jezykozaka']],
  ['jzk_ai',          ['jezykozak ai', 'jezykozak']],
  ['jsu_course',      ['kurs online jak sie uczyc', 'kurs jak sie uczyc']],

  // ── shop ───────────────────────────────────────────────────────────────
  ['szurawski_pack',  ['pakiet szkolen marka szurawskiego', 'szurawskiego']],
  ['hi_memory',       ['hi memory']],
  ['memory_training_pdf', ['pamiec trening interaktywny pdf']],
  ['memory_training', ['pamiec trening interaktywny']],
  ['lang_3t_pdf',     ['3 zadziwiajace techniki nauki jezykow pdf']],
  ['lang_3t_single',  ['3 zadziwiajace techniki nauki jezykow',
                       'zadziwiajace techniki nauki jezykow']],
  ['slowoszyt_pdf',   ['slowoszyt']],
  ['jsu_pdf',         ['jak sie uczyc pdf']],
  ['jsu_book',        ['jak sie uczyc']],
  ['book_historie',   ['historie ktore zostaja']],
  ['book_mysz',       ['opowiesc o skaczacej myszy']],
  ['book_ptaki',      ['jak zapamietywac glosy ptakow']],
  ['book_mysli_chlopiec',     ['badz dobrej mysli dla chlopca']],
  ['book_mysli_dziewczynka',  ['badz dobrej mysli dla dziewczynki']],
  ['techniki_przywolujace',   ['techniki przywolujace']],
  ['test_iwm',        ['test na rozpoznanie indywidualnych wzorcow mysleni']],
  ['book_8020',       ['80 20 zasada ktora uksztaltowala swiat', '80 20 zasada']],

  // ── outside the funnels ────────────────────────────────────────────────
  ['pso',             ['perfect student online', 'perfect student', 'pso']],
  ['wsztp',           ['wakacyjna szkola treningu pamieci', 'wakacyjna', 'wsztp']],
]

/**
 * The best name match, or null.
 *
 * Longest pattern wins. A tie between two DIFFERENT products is reported
 * rather than broken — picking one would be the same coin-flip that sent
 * every Perfect Student Online sale into Cogni.
 *
 * Robust to: case, accents, straight vs typographic dashes, doubled spaces,
 * brackets, trailing marketing text and a truncated name — all of which
 * normalizeText() flattens before anything is compared, and none of which
 * changes which pattern is longest.
 *
 * @returns {{key: string|null, pattern: string|null, tie: string[]|null}}
 */
export function nameMatch(rawName) {
  const norm = normalizeText(rawName)
  if (!norm) return { key: null, pattern: null, tie: null }

  let key = null, pattern = null, best = 0
  let tied = []
  for (const [candidate, list] of NAME_PATTERNS) {
    for (const pat of list) {
      if (!norm.includes(pat)) continue
      if (pat.length > best) {
        key = candidate; pattern = pat; best = pat.length; tied = [candidate]
      } else if (pat.length === best && !tied.includes(candidate)) {
        tied.push(candidate)
      }
    }
  }
  if (tied.length > 1) return { key: null, pattern: null, tie: tied }
  return { key, pattern, tie: null }
}

export function nameMatchKey(rawName) {
  return nameMatch(rawName).key
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
  // Asked before anything else, so no name pattern can swallow an emptied
  // cart or a manual grant and turn it into revenue with a cost attached.
  const nonSale = nonSaleVerdict(amt, rawName, paymentProvider)
  if (nonSale.category) {
    return {
      productKey: null, scope: null, bucket: 'NON_SALE', qty: 1, margin: null,
      matchedBy: nonSale.evidence, conflict: null, failedField: null,
      nonSaleCategory: nonSale.category,
    }
  }
  if (nonSale.reason) {
    return {
      productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
      matchedBy: null, conflict: null, failedField: nonSale.reason,
    }
  }

  // ── THE NAME IS THE ONLY KEY ─────────────────────────────────────────────
  const match = nameMatch(rawName)

  if (match.tie) {
    // Two products matched equally well. Picking one would be a coin flip,
    // and a coin flip is how every Perfect Student Online sale spent four
    // months being reported as Cogni.
    const names = match.tie.map(k => PRODUCTS[k].displayName).join(', ')
    return {
      productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
      matchedBy: null, conflict: null,
      failedField: `kolizja nazwy: "${String(rawName ?? '').slice(0, 50)}" pasuje `
        + `jednakowo dobrze do ${match.tie.length} produktów (${names}) — nie zgaduję`,
      nameCollision: match.tie,
    }
  }

  if (match.key) return decide(match.key, amt, `name "${match.pattern}"`, null)

  // Nothing matched. The amount is reported because it is useful context, but
  // it played no part in the decision and must never start playing one.
  return {
    productKey: null, scope: null, bucket: 'UNMAPPED', qty: null, margin: null,
    matchedBy: null, conflict: null,
    failedField: normalizeText(rawName)
      ? `product_name_raw nie pasuje do żadnego wzorca w katalogu `
        + `(kwota ${amt} zł jest tylko kontekstem — cena nie klasyfikuje)`
      : `product_name_raw puste (kwota ${amt} zł nie wystarcza — cena nie klasyfikuje)`,
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

/**
 * Startup check: no two products can be told apart only by price.
 *
 * After PRICE_TO_PRODUCTS was deleted this is close to a tautology — there is
 * no price path left, so nothing CAN rely on one. The test is kept anyway,
 * stated as a property rather than an absence: it fails if a price map ever
 * reappears, and it fails if two entries share a name pattern, which is the
 * same ambiguity moved to the only key that is left.
 */
export function assertNoPriceOnlyProducts() {
  const problems = []

  // Every product must be reachable by name. One that is not could only ever
  // be selected by its price, which is exactly what is forbidden.
  const named = new Set(NAME_PATTERNS.map(([key]) => key))
  for (const key of Object.keys(PRODUCTS)) {
    if (!named.has(key)) problems.push(`${key}: no name pattern — unreachable except by price`)
  }

  // A pattern owned by two products is ambiguous for every order that matches
  // it, and the only tiebreaker left would be the price.
  const owner = new Map()
  for (const [key, patterns] of NAME_PATTERNS) {
    for (const pat of patterns) {
      if (owner.has(pat) && owner.get(pat) !== key) {
        problems.push(`pattern "${pat}" is claimed by both ${owner.get(pat)} and ${key}`)
      }
      owner.set(pat, key)
    }
  }

  if (problems.length > 0) {
    throw new Error('productCatalog: a product would depend on its price\n  ' + problems.join('\n  '))
  }
}

// The catalog checks itself on load. A product reachable only by price, a
// pattern two products both claim, or an entry that neither states its margin
// nor admits it does not know it — each is a build failure rather than a
// runtime surprise.
assertNoPriceOnlyProducts()
assertCatalogIsComplete()
