// Frontend helper for the ops-week-report backend function.
// Provides types + a cached fetch (55 s — matches auto-refresh interval).
import { bustUrl } from '../utils/cacheBust'

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
  product_tag: 'JSU' | 'JZK' | 'OTHER'
  product_name: string
  schedule_reason: string
  warsaw_weekday: string
  warsaw_time: string
  is_jsu: boolean
  is_jzk: boolean
  participants: number
}

export interface OpsWeekWebinars {
  this_week: {
    all_sessions: number
    jsu_sessions: number
    jsu_participants: number
    jzk_sessions: number
    jzk_participants: number
    all_participants: number
    sessions: OpsWeekSession[]
    jsu_sessions_list: OpsWeekSession[]
    jzk_sessions_list: OpsWeekSession[]
  }
  yesterday: {
    all_sessions: number
    jsu_sessions: number
    jsu_participants: number
    jzk_sessions: number
    jzk_participants: number
    jsu_sessions_list: OpsWeekSession[]
    jzk_sessions_list: OpsWeekSession[]
  }
}

export interface OrderDiagnosticRow {
  external_order_id: string | null
  email_masked: string
  product_name_raw: string | null
  amount: number
  classified_product: string
  product_label: string
  classification_reason: string
  classification_warning?: string | null
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
    price_warnings_count?: number
    order_diagnostics?: OrderDiagnosticRow[]
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
  jzk_webinar_ran_yesterday: boolean
  jsu_sales_this_week: number
  jsu_sales_yesterday: number
  memory_pack_sales_this_week: number
  total_participants_this_week: number
  jsu_participants_this_week: number
  jzk_participants_this_week: number
}

export interface OpsWeekDebug {
  source: string
  scheduleRule?: string
  ordersTable?: string
  priceRulesApplied?: boolean
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
  if (_cache && Date.now() - _cache.fetchedAt < 55_000) {
    return _cache.report
  }
  const res = await fetch(bustUrl('/.netlify/functions/ops-week-report'), {
    headers: { 'Cache-Control': 'no-store' },
  })
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
