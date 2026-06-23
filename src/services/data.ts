import { supabase } from './supabase'

export interface DailyPerformance {
  date: string
  meta_spend: number
  wix_orders: number
  wix_revenue: number
  real_cpa: number | null
  real_roas: number | null
  impressions: number
  clicks: number
  link_clicks: number
  ads_count: number
  // Added when v_daily_wix_meta_performance view gets migration add_meta_purchases_to_view.sql
  meta_purchases?: number | null
  meta_purchase_value?: number | null
}

export interface MetaAdDaily {
  date: string
  campaign_id?: string | null
  campaign_name?: string | null
  adset_id?: string | null
  ad_id?: string | null
  spend: number
  impressions?: number | null
  clicks?: number | null
  link_clicks?: number | null
  // DB column is meta_purchases (webhook naming). purchases kept for backward compat.
  meta_purchases?: number | null
  purchases?: number | null
  ctr?: number | null
  cpc?: number | null
  cpm?: number | null
  meta_purchase_value?: number | null
}

export interface AutomationRun {
  id: string
  scenario_name: string
  status: string
  ran_at: string
  rows_inserted: number | null
  error_message: string | null
}

export interface MetaStatsToday {
  meta_purchases: number
  latestDate: string
  isStale: boolean
}

export type DataStatus = 'OK' | 'META_NOT_LIVE' | 'SALES_WARNING' | 'NO_DATA'

export function computeStatus(row: DailyPerformance | null): DataStatus {
  if (!row) return 'NO_DATA'
  const spend = row.meta_spend ?? 0
  const orders = row.wix_orders ?? 0
  if (orders === 0 && spend === 0) return 'NO_DATA'
  if (orders > 0 && spend === 0) return 'META_NOT_LIVE'
  if (spend > 0 && orders === 0) return 'SALES_WARNING'
  return 'OK'
}

export async function fetchTodayPerformance(): Promise<DailyPerformance | null> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const { data, error } = await supabase
    .from('v_daily_wix_meta_performance')
    .select('*')
    .eq('date', today)
    .maybeSingle()

  if (error) {
    console.error('fetchTodayPerformance error', error)
    return null
  }
  return data as DailyPerformance | null
}

export async function fetchRecentPerformance(days = 7): Promise<DailyPerformance[]> {
  const { data, error } = await supabase
    .from('v_daily_wix_meta_performance')
    .select('*')
    .order('date', { ascending: false })
    .limit(days)

  if (error) {
    console.error('fetchRecentPerformance error', error)
    return []
  }
  return (data ?? []) as DailyPerformance[]
}

export async function fetchTopAds(date?: string): Promise<MetaAdDaily[]> {
  const targetDate = date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const { data, error } = await supabase
    .from('meta_ads_daily')
    .select('*')
    .eq('date', targetDate)
    .order('spend', { ascending: false })
    .limit(10)

  if (error) {
    console.error('fetchTopAds error', error)
    return []
  }

  // If today has no rows, fall back to latest available date
  if ((data ?? []).length === 0 && !date) {
    const { data: latestData, error: latestError } = await supabase
      .from('meta_ads_daily')
      .select('*')
      .order('date', { ascending: false })
      .order('spend', { ascending: false })
      .limit(10)
    if (latestError) {
      console.error('fetchTopAds latest fallback error', latestError)
      return []
    }
    if ((latestData ?? []).length > 0) {
      console.log('fetchTopAds: no data for', targetDate, '— using', latestData![0].date)
    }
    return (latestData ?? []) as MetaAdDaily[]
  }

  return (data ?? []) as MetaAdDaily[]
}

export async function fetchAutomationRuns(limit = 5): Promise<AutomationRun[]> {
  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('fetchAutomationRuns error', error)
    return []
  }
  return (data ?? []) as AutomationRun[]
}

export async function fetchMetaStatsToday(): Promise<MetaStatsToday> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

  const [{ data: todayRows }, { data: latestRow }] = await Promise.all([
    supabase.from('meta_ads_daily').select('meta_purchases,purchases').eq('date', today),
    supabase.from('meta_ads_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
  ])

  const meta_purchases = (todayRows ?? []).reduce((s, r) => {
    const row = r as MetaAdDaily
    return s + (row.meta_purchases ?? row.purchases ?? 0)
  }, 0)
  const latestDate = (latestRow as { date?: string } | null)?.date ?? ''
  const isStale = latestDate !== '' && latestDate < today

  return { meta_purchases, latestDate, isStale }
}
