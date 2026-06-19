// Frontend helper for the ops-week-report backend function.
// Provides types + a 2-minute cached fetch.

export interface OpsWeekRange {
  week_start: string
  week_end: string
  yesterday: string
  today: string
  timezone: string
}

export interface OpsWeekSession {
  session_id: string
  session_name: string
  scheduled_at: string
  date: string
  product_tag: string | null
  is_jsu: boolean
  participants: number
}

export interface OpsWeekWebinars {
  this_week: {
    all_sessions: number
    jsu_sessions: number
    jsu_participants: number
    all_participants: number
    sessions: OpsWeekSession[]
  }
  yesterday: {
    all_sessions: number
    jsu_sessions: number
    jsu_participants: number
    sessions: OpsWeekSession[]
  }
}

export interface OpsWeekOrders {
  this_week: {
    all_orders: number
    all_revenue: number
    jsu_course_orders: number
    jsu_course_revenue: number
    memory_pack_orders: number
    memory_pack_revenue: number
    jzk_orders: number
    unclassified_orders: number
    data_source: string
    product_classification: 'available' | 'unavailable'
  }
  yesterday: {
    all_orders: number
    all_revenue: number
    jsu_course_orders: number
    jsu_course_revenue: number
  }
}

export interface OpsWeekAttribution {
  yesterday_webinar_participants: number
  jsu_sales_after_webinar: number
  attributed_sales: number
  attribution_reason: string
}

export interface OpsWeekSummary {
  jsu_webinar_ran_yesterday: boolean
  jsu_sales_this_week: number
  jsu_sales_yesterday: number
  memory_pack_sales_this_week: number
  total_participants_this_week: number
  jsu_participants_this_week: number
}

export interface OpsWeekDebug {
  source: string
  wixOrdersTableExists: boolean
  wixOrdersHasProductData: boolean
  wixOrdersHasEmailData: boolean
  wixOrdersError: string | null
  webinarSessionsError: string | null
  webinarParticipantsError: string | null
  wixPerformanceError: string | null
  orderClassificationSource: string
}

export interface OpsWeekReport {
  ok: boolean
  range: OpsWeekRange
  webinars: OpsWeekWebinars
  orders: OpsWeekOrders
  attribution: OpsWeekAttribution
  meta: {
    this_week_spend: number
    this_week_impressions: number
  }
  summary: OpsWeekSummary
  debug: OpsWeekDebug
  error?: string
}

// 2-minute in-memory cache
let _cache: { report: OpsWeekReport; fetchedAt: number } | null = null

export async function fetchOpsWeekReport(): Promise<OpsWeekReport> {
  if (_cache && Date.now() - _cache.fetchedAt < 120_000) {
    return _cache.report
  }
  const res = await fetch('/.netlify/functions/ops-week-report')
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ops-week-report HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const report = await res.json() as OpsWeekReport
  _cache = { report, fetchedAt: Date.now() }
  return report
}

export function clearOpsWeekCache(): void {
  _cache = null
}
