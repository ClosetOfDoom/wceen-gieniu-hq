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
  missingProductData: boolean
  reason: string
}

export interface OrderLike {
  product_name?: string | null
  item_name?: string | null
  line_items?: Array<{ name?: string | null; sku?: string | null }> | null
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

export function classifyOrder(order: OrderLike): ClassifiedOrder {
  if (order.line_items && order.line_items.length > 0) {
    const first = order.line_items[0]
    const name = first.name ?? first.sku ?? null
    if (name) {
      return {
        productLine: classifyProductName(name),
        productName: name,
        missingProductData: false,
        reason: 'classified from line_items[0]',
      }
    }
  }
  if (order.product_name) {
    return {
      productLine: classifyProductName(order.product_name),
      productName: order.product_name,
      missingProductData: false,
      reason: 'classified from product_name',
    }
  }
  if (order.item_name) {
    return {
      productLine: classifyProductName(order.item_name),
      productName: order.item_name,
      missingProductData: false,
      reason: 'classified from item_name',
    }
  }
  return {
    productLine: 'UNKNOWN_UNCLASSIFIABLE',
    productName: null,
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
