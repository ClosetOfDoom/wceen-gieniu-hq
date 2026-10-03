// Typed fetch helper for /.netlify/functions/orders-data
// Canonical orders source: service role, absolute price classification.
// Used by GIENIU intent handlers for "ile dziś zamówień" and similar queries.
import { bustUrl } from '../utils/cacheBust'
import type { DaySeriesEntry } from './alerts'

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

/** One FULL Warsaw day, with the hour profile the in-progress day is compared against. */
export interface DailySeriesDay extends DaySeriesEntry {
  revenue: number
  /** Orders per Warsaw hour, 24 entries. */
  hourly: number[]
}

export interface OrdersData {
  ok: boolean
  timestamp: string
  today_warsaw: string
  week_start: string
  source_table: string
  totals: {
    all_orders: number
    /** Raw order ROWS read before grouping by order id — equals all_orders while
     *  the table stores one row per order. A gap means line items arrived. */
    order_rows?: number
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
  today_classified: {
    jsu_course:   { count: number; revenue: number }
    jzk_language: { count: number; revenue: number }
    memory_pack:  { count: number; revenue: number }
    unknown:      { count: number }
  }
  latest_20_orders: OrderRow[]
  /**
   * FULL Warsaw days only, oldest first — the series every alarm rule runs on.
   * Built in orders-data.js straight from `orders`, because the daily view
   * still buckets by the UTC day and has no row at all for a day the sync
   * never delivered. `missing` marks exactly that case, and is never a zero.
   */
  dailySeries?: DailySeriesDay[]
  /** The in-progress day. Kept out of dailySeries so no alarm can fire on it. */
  todayHourly?: { date: string; orders: number; revenue: number; hourly: number[] }
  /** First day `orders` has any row for — days before it are prehistory. */
  recordStartsOn?: string | null
  /** Orders at or below this amount are test orders and are not counted. */
  orderMinAmount?: number
  error?: string
}

let _cache: OrdersData | null = null
let _cacheTime = 0
const CACHE_TTL = 55 * 1000  // 55 s — just under 60 s auto-refresh interval

export async function fetchOrdersData(): Promise<OrdersData | null> {
  const now = Date.now()
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache

  try {
    const res = await fetch(bustUrl('/.netlify/functions/orders-data'), {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
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
