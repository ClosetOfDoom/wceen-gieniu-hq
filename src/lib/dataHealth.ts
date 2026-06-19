// Typed fetch helper for /.netlify/functions/data-health
// Service-role diagnostic: checks all operational Supabase tables.

export interface DataHealthOrders {
  count: number | null
  count_error: string | null
  latest_order_date: string | null
  today_count: number
  today_revenue: number
  week_count: number
  week_revenue: number
  latest_5: Array<{
    external_order_id: string
    email_masked: string
    product_name_raw: string
    amount: number
    order_date: string
  }>
  error: string | null
}

export interface DataHealthWebinars {
  sessions_count: number | null
  sessions_error: string | null
  latest_session_at: string | null
  latest_session_name: string | null
  participants_count: number | null
  participants_error: string | null
  latest_participant_at: string | null
}

export interface DataHealthMetaAds {
  count: number | null
  count_error: string | null
  latest_date: string | null
  latest_inserted_at: string | null
  campaign_names: string[]
  error: string | null
}

export interface DataHealthCommandCenterSource {
  table: string
  count: number | null
  latest_date: string | null
  has_meta_spend: boolean
  total_spend_7d: number
  error: string | null
}

export interface DataHealthMeta {
  meta_ads_daily: DataHealthMetaAds
  command_center_source: DataHealthCommandCenterSource
  campaigns_source: { table: string; count: number | null; latest_date: string | null }
  source_mismatch: boolean
  source_mismatch_explanation: string | null
}

export interface DataHealthReport {
  ok: boolean
  timestamp: string
  today_warsaw: string
  week_start: string
  orders: DataHealthOrders
  webinars: DataHealthWebinars
  meta: DataHealthMeta
  error?: string
}

let _cache: DataHealthReport | null = null
let _cacheTime = 0
const CACHE_TTL = 2 * 60 * 1000

export async function fetchDataHealth(): Promise<DataHealthReport | null> {
  const now = Date.now()
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache

  try {
    const res = await fetch('/.netlify/functions/data-health', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn('data-health endpoint error:', res.status)
      return null
    }
    const data = (await res.json()) as DataHealthReport
    _cache = data
    _cacheTime = now
    return data
  } catch (e) {
    console.warn('fetchDataHealth failed:', e)
    return null
  }
}
