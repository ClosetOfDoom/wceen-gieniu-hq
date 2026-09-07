// Types for productCatalog.js. The implementation is plain ESM JS because it is
// shared with the Netlify Functions runtime; this file is the typed contract for
// anything that imports it from TypeScript (currently the unit tests).

export type ProductKey =
  | 'memory_pack' | 'language_3t' | 'jezykozak_pack' | 'jzk_ai'
  | 'jsu_course' | 'cogni_promo' | 'cogni_regular' | 'wsztp'

export type ProductScope = 'memory' | 'language' | 'cogni'

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
}

export const PRODUCTS: Record<ProductKey, CatalogProduct>
export const PRICE_TO_PRODUCT: Record<number, ProductKey>
export const SHIPPING_PATTERNS: string[]

export function unitCostOf(productKey: ProductKey | string): number | null
export function isExcludedFromBlended(productKey: ProductKey | string): boolean
export function isCountableOrder(row: Record<string, unknown>): boolean
export function normalizeText(s: unknown): string
export function isShippingLine(rawName: unknown): boolean
export function nameMatchKey(rawName: unknown): ProductKey | null

export type Bucket = 'MAPPED' | 'EXCLUDED' | 'UNKNOWN_MARGIN' | 'AMBIGUOUS' | 'UNMAPPED'

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
  /** Why the product is out of the blended figures. Only on EXCLUDED. */
  excludedReason?: string
}

export function classifyAmount(amount: number, rawName?: unknown): Decision

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
