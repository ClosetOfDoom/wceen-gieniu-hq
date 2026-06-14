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
}

export interface MetaAdDaily {
  date: string
  campaign_id: string
  campaign_name: string
  adset_id: string
  ad_id: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  purchases: number
}

export interface AutomationRun {
  id: string
  scenario_name: string
  status: string
  ran_at: string
  rows_inserted: number | null
  error_message: string | null
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
