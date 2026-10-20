// Types for productCatalog.js. The implementation is plain ESM JS because it is
// shared with the Netlify Functions runtime; this file is the typed contract for
// anything that imports it from TypeScript (currently the unit tests).

// Cogni is absent on purpose: it is sold through Stripe only, never through
// Wix, so no `orders` row can be one. An entry for it could only mislabel
// something else — and did, until fd7551b, because it shared 499 PLN with PSO.
export type ProductKey = string

/** `other` = sold, but outside both Meta funnels, so no spend chased it. */
export type ProductScope = 'memory' | 'language' | 'other'

export interface CatalogProduct {
  key: ProductKey
  displayName: string
  shortName: string
  scope: ProductScope
  catalogPrice: number
  /** PLN per unit at catalogPrice. `null` = not known; never guessed, never 0. */
  contributionMargin: number | null
  /** Kept out of blended profit / CPA / ROAS on purpose (WSZTP). */
  excludeFromBlendedProfit?: boolean
  /**
   * Set when contributionMargin is null BECAUSE NOBODY KNOWS IT, as opposed to
   * because a number went missing. assertCatalogIsComplete() requires one or
   * the other, so the difference cannot be left implicit.
   */
  marginUnknown?: boolean
  /** What to go and ask for, e.g. "marża PSO nieznana — brak w briefingu". */
  marginUnknownReason?: string
}

export const PRODUCTS: Record<ProductKey, CatalogProduct>
/** Throws when an entry neither states its margin nor admits it is unknown. */
export function assertCatalogIsComplete(): void
export const SHIPPING_PATTERNS: string[]

export function unitCostOf(productKey: ProductKey | string): number | null
export function isExcludedFromBlended(productKey: ProductKey | string): boolean
export function isCountableOrder(row: Record<string, unknown>): boolean
export function normalizeText(s: unknown): string
export function isShippingLine(rawName: unknown): boolean
export function nameMatchKey(rawName: unknown): ProductKey | null

/**
 * The best name match. Longest matching pattern wins, so a variant beats the
 * product it is a variant of ("Jak się uczyć (PDF)" over "Jak się uczyć").
 * A tie between two products is reported, never broken.
 */
export function nameMatch(rawName: unknown): {
  key: ProductKey | null
  pattern: string | null
  tie: ProductKey[] | null
}

/** Throws when a product could only be selected by its price. Runs at load. */
export function assertNoPriceOnlyProducts(): void

export type Bucket =
  | 'MAPPED' | 'EXCLUDED' | 'UNKNOWN_MARGIN' | 'AMBIGUOUS' | 'UNMAPPED'
  /** Never a transaction: an emptied cart, a lead magnet, a manual grant. */
  | 'NON_SALE'

export interface Decision {
  productKey: ProductKey | null
  scope: ProductScope | null
  bucket: Bucket
  qty: number | null
  /** Only ever a number when bucket is MAPPED. */
  margin: number | null
  minMargin?: number
  matchedBy: string | null
  conflict: { priceProduct: ProductKey; priceAmount: number; nameProduct: ProductKey } | null
  /** Which field the match broke on. Null for MAPPED and for EXCLUDED — an
   *  exclusion is a decision, so there is no field for anyone to go and fix. */
  failedField: string | null
  /** Set when two products matched the name equally well and neither won. */
  nameCollision?: ProductKey[]
  /** Why the product is out of the blended figures. Only on EXCLUDED. */
  excludedReason?: string
  /** Which kind of non-sale, set on NON_SALE. No revenue, no cost, no margin. */
  nonSaleCategory?: NonSaleCategory
}

/**
 * @param paymentProvider Wix's "Operator płatności". Null means UNKNOWN, which
 *   is deliberately not the same as "not Offline" — see ADMIN_ACCESS.
 */
export function classifyAmount(
  amount: number, rawName?: unknown, paymentProvider?: unknown,
): Decision

export type NonSaleCategory = 'empty_cart' | 'lead_magnet' | 'admin_access'

/** The non-sale rules, declared in one place. */
export const NON_SALE: {
  adminMaxAmount: number
  adminOperator: string
  adminGrantName: string
  leadMagnetPrefix: string
}

/** Human labels, so the card, COPY and Q&A cannot drift apart. */
export const NON_SALE_LABELS: Record<NonSaleCategory, string>

export function nonSaleVerdict(
  amount: number, rawName: unknown, provider: unknown,
): { category: NonSaleCategory; evidence: string } | { category: null; reason: string | null }

export function extractPaymentProvider(row: Record<string, unknown> | null | undefined): string | null

export interface AggregatedOrder {
  orderId: string
  orderDate: string
  /** Everything the customer paid, shipping included — reconciles with wix_revenue. */
  revenue: number
  /** Product lines only — what the classification runs on. */
  productAmount: number
  shippingAmount: number
  productNameRaw: string | null
  email: string
  /** Wix's payment operator, or null when this system cannot know it. */
  paymentProvider: string | null
  lineCount: number
  shippingLineCount: number
  raw: Array<Record<string, unknown>>
}

export function aggregateOrders(rows: Array<Record<string, unknown>>): AggregatedOrder[]
export function classifyOrder(order: AggregatedOrder): Decision

export function toWarsawDate(val: unknown): string
export function warsawToday(): string
export function extractOrderDate(row: Record<string, unknown>): string
export function extractOrderId(row: Record<string, unknown>): string
export function extractProductNameRaw(row: Record<string, unknown>): string | null
export function extractAmount(row: Record<string, unknown>): number
export function extractEmail(row: Record<string, unknown>): string
export function maskEmail(email: string): string

export function fetchOrdersInRange(
  supabaseUrl: string, serviceKey: string, table: string, from: string, to: string,
): Promise<Array<Record<string, unknown>>>
export function fetchAllOrders(
  supabaseUrl: string, serviceKey: string, table: string,
): Promise<Array<Record<string, unknown>>>
