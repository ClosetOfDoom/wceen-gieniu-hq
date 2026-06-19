// Typed fetch helper for /.netlify/functions/orders-data
// Canonical orders source: service role, absolute price classification.
// Used by GIENIU intent handlers for "ile dziś zamówień" and similar queries.

export interface OrderRow {
  external_order_id: string
  email_masked: string
  product_name_raw: string
  amount: number
  order_date: string
  classified_product: 'JSU_COURSE' | 'JZK_LANGUAGE' | 'MEMORY_PACK' | 'UNKNOWN'
  product_label: string
  classification_reason: string
  classification_warning: string | null
}

export interface OrdersData {
  ok: boolean
  timestamp: string
  today_warsaw: string
  week_start: string
  source_table: string
  totals: {
    all_orders: number
    latest_order_date: string | null
    today_orders: number
    today_revenue: number
    week_orders: number
    week_revenue: number
  }
  classified: {
    jsu_course:   { count: number; revenue: number }
    jzk_language: { count: number; revenue: number }
    memory_pack:  { count: number; revenue: number }
    unknown:      { count: number }
    price_warnings: number
  }
  latest_20_orders: OrderRow[]
  error?: string
}

let _cache: OrdersData | null = null
let _cacheTime = 0
const CACHE_TTL = 2 * 60 * 1000

export async function fetchOrdersData(): Promise<OrdersData | null> {
  const now = Date.now()
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache

  try {
    const res = await fetch('/.netlify/functions/orders-data', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn('orders-data endpoint error:', res.status)
      return null
    }
    const data = (await res.json()) as OrdersData
    _cache = data
    _cacheTime = now
    return data
  } catch (e) {
    console.warn('fetchOrdersData failed:', e)
    return null
  }
}
