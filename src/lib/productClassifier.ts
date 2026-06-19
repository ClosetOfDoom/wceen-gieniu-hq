// Product classification for Wix orders.
// Classification is ONLY possible when order line items (product_name, SKU) are present.
// v_daily_wix_meta_performance is an aggregate view — no line items exist there.
// Until the Make → Wix ingestion is extended to save per-line-item data, all orders
// are UNKNOWN_UNCLASSIFIABLE and must be reported as such.

export type ProductLine =
  | 'MEMORY_PACK'
  | 'JSU_COURSE'
  | 'MEMORY_BOOK'
  | 'JZK_LANGUAGE'
  | 'WSZTP'
  | 'MARITIME'
  | 'OTHER'
  | 'UNKNOWN_UNCLASSIFIABLE'

export interface ClassifiedOrder {
  productLine: ProductLine
  productName: string | null
  productLabel: string
  missingProductData: boolean
  reason: string
  classificationWarning?: string | null
}

export interface PriceClassification {
  productLine: ProductLine
  productLabel: string
  reason: string
  usedPriceFallback: boolean
}

export interface OrderLike {
  product_name?: string | null
  product_name_raw?: string | null
  item_name?: string | null
  amount?: number | null
  total?: number | null
  price?: number | null
  line_items?: Array<{ name?: string | null; sku?: string | null }> | null
}

function extractAmount(order: OrderLike): number {
  const n = Number(order.amount ?? order.total ?? order.price ?? 0)
  return isNaN(n) ? 0 : n
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MEMORY_PACK_PATTERNS = [
  'pakiet pamieci', 'pakiet pamieciowy', 'memory pack', 'memory bundle', 'memory kit',
  'pakiet mix pamieci', 'gieniu pack',
]

const JSU_COURSE_PATTERNS = [
  'jak sie uczyc', 'jsu', 'kurs jak sie', 'trening pamieci', 'kurs pamieci online',
]

const MEMORY_BOOK_PATTERNS = [
  'ksiazka o pamieci', 'ebook pamieci', 'memory book', 'podrecznik pamieci',
]

const JZK_LANGUAGE_PATTERNS = [
  'jezykozak', 'nauka jezykow', 'jzk', 'language course', 'kurs jezykowy',
]

const WSZTP_PATTERNS = [
  'wsztp', 'wszystko trzeba',
]

const MARITIME_PATTERNS = [
  'szanty', 'shanty', 'morski', 'maritime',
]

/** Mask an email for safe display: "filip@gmail.com" → "fi***@gmail.com" */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***'
  const [local, domain] = email.split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

const JSU_NAME_PATTERNS  = ['jak sie uczyc', 'kurs jak sie', 'jsu']
const JZK_NAME_PATTERNS  = ['jezykozak', 'jezykowy', 'nauka jezykow', 'jzk', 'jezyk']
const MEMORY_NAME_119    = ['pamiec', 'trening interaktywny', 'pakiet pamieciowy', 'memory']

/**
 * Absolute price rules — business rule, no keyword checks needed.
 * 549 PLN = JSU_COURSE | 347 PLN = JZK_LANGUAGE | 119 PLN = MEMORY_PACK
 * Returns null for other amounts (caller falls back to text classification).
 * Warning is emitted when product_name_raw contradicts the price rule.
 */
export function classifyByPrice(
  amount: number,
  productNameRaw: string | null | undefined,
): PriceClassification | null {
  const norm = normalizeText(productNameRaw ?? '')

  // Absolute rule 1: 549 PLN = JSU course
  if (amount === 549) {
    const nameContradicts = !JSU_NAME_PATTERNS.some(p => norm.includes(p)) && norm.length > 0
    return {
      productLine: 'JSU_COURSE',
      productLabel: 'Kurs Jak się uczyć',
      reason: 'absolute price rule: 549 PLN = JSU',
      usedPriceFallback: nameContradicts,
    }
  }

  // Absolute rule 2: 347 PLN = Językozak AI
  if (amount === 347) {
    const nameContradicts = !JZK_NAME_PATTERNS.some(p => norm.includes(p)) && norm.length > 0
    return {
      productLine: 'JZK_LANGUAGE',
      productLabel: 'Językozak AI',
      reason: 'absolute price rule: 347 PLN = Językozak AI',
      usedPriceFallback: nameContradicts,
    }
  }

  // Absolute rule 3: 119 PLN = memory pack
  if (amount === 119) {
    const nameContradicts = !MEMORY_NAME_119.some(p => norm.includes(p)) && norm.length > 0
    return {
      productLine: 'MEMORY_PACK',
      productLabel: 'Pakiet pamięciowy',
      reason: 'absolute price rule: 119 PLN = memory pack',
      usedPriceFallback: nameContradicts,
    }
  }

  // Name contains JSU keywords → JSU_COURSE regardless of price
  if (JSU_NAME_PATTERNS.some(p => norm.includes(p))) {
    return {
      productLine: 'JSU_COURSE',
      productLabel: 'Kurs Jak się uczyć',
      reason: 'product name matches JSU pattern',
      usedPriceFallback: false,
    }
  }

  return null
}

export function classifyProductName(name: string): ProductLine {
  const n = normalizeText(name)
  if (MEMORY_PACK_PATTERNS.some(p => n.includes(p))) return 'MEMORY_PACK'
  if (JSU_COURSE_PATTERNS.some(p => n.includes(p))) return 'JSU_COURSE'
  if (MEMORY_BOOK_PATTERNS.some(p => n.includes(p))) return 'MEMORY_BOOK'
  if (JZK_LANGUAGE_PATTERNS.some(p => n.includes(p))) return 'JZK_LANGUAGE'
  if (WSZTP_PATTERNS.some(p => n.includes(p))) return 'WSZTP'
  if (MARITIME_PATTERNS.some(p => n.includes(p))) return 'MARITIME'
  return 'OTHER'
}

const PRODUCT_LINE_LABELS: Record<ProductLine, string> = {
  JSU_COURSE:             'Kurs Jak się uczyć',
  MEMORY_PACK:            'Pakiet pamięciowy',
  MEMORY_BOOK:            'Ebook pamięci',
  JZK_LANGUAGE:           'Językozak AI',
  WSZTP:                  'WSZTP',
  MARITIME:               'Szanty',
  OTHER:                  'Inne',
  UNKNOWN_UNCLASSIFIABLE: 'Niesklasyfikowany',
}

export function classifyOrder(order: OrderLike): ClassifiedOrder {
  const amount     = extractAmount(order)
  const rawName    = order.product_name_raw ?? order.product_name ?? null

  // Price-first: 549 PLN = JSU_COURSE; 347 PLN requires language name; etc.
  if (amount > 0 || rawName) {
    const priceResult = classifyByPrice(amount, rawName)
    if (priceResult) {
      const warning = priceResult.usedPriceFallback
        ? `Product name from Wix may be wrong/misaligned ("${(rawName ?? '').slice(0, 50)}"). Classification used price fallback.`
        : null
      return {
        productLine:           priceResult.productLine,
        productLabel:          priceResult.productLabel,
        productName:           rawName,
        missingProductData:    false,
        reason:                priceResult.reason,
        classificationWarning: warning,
      }
    }
  }

  // Fallback: line_items → product_name → item_name (text-based)
  if (order.line_items && order.line_items.length > 0) {
    const first = order.line_items[0]
    const name = first.name ?? first.sku ?? null
    if (name) {
      const pl = classifyProductName(name)
      return { productLine: pl, productLabel: PRODUCT_LINE_LABELS[pl], productName: name, missingProductData: false, reason: 'classified from line_items[0]' }
    }
  }
  if (order.product_name) {
    const pl = classifyProductName(order.product_name)
    return { productLine: pl, productLabel: PRODUCT_LINE_LABELS[pl], productName: order.product_name, missingProductData: false, reason: 'classified from product_name' }
  }
  if (order.item_name) {
    const pl = classifyProductName(order.item_name)
    return { productLine: pl, productLabel: PRODUCT_LINE_LABELS[pl], productName: order.item_name, missingProductData: false, reason: 'classified from item_name' }
  }
  return {
    productLine:    'UNKNOWN_UNCLASSIFIABLE',
    productLabel:   PRODUCT_LINE_LABELS['UNKNOWN_UNCLASSIFIABLE'],
    productName:    null,
    missingProductData: true,
    reason: 'no product_name, item_name, or line_items in order data',
  }
}

/** GIENIU is currently in this state — all orders are unclassifiable */
export const PRODUCT_CLASSIFICATION_AVAILABLE = false
export const PRODUCT_CLASSIFICATION_REASON =
  'v_daily_wix_meta_performance stores aggregate order counts only. ' +
  'No product names or line items are saved by the current Make scenario. ' +
  'See docs/wix_orders_product_mapping_fix.md for the fix.'
