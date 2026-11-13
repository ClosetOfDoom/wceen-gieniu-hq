import { businessToday } from '../lib/businessDay'
import { supabase, pagedSelect } from './supabase'
import { bustUrl } from '../utils/cacheBust'
import { applySpendSplit, type AdSpendSplit, type ExcludedCampaign } from '../lib/adSpend'

export interface DailyPerformance {
  date: string
  /**
   * BLENDED ad spend — the part that may be a denominator for Wix orders.
   *
   * The view hands back everything Meta spent, Cogni included; withSpendSplit()
   * below replaces it with the blended figure and moves the rest into
   * `meta_spend_excluded`. So every consumer that divides this into orders
   * (real CPA, real ROAS, the daily table, the trend) is right without knowing
   * Cogni exists. A consumer that wants what Meta actually BILLED must add the
   * two — use totalSpendOf() from lib/adSpend.ts, never `meta_spend` alone.
   *
   * Only trust that reading when `spend_split === 'applied'`.
   */
  meta_spend: number
  /** Spend kept out of the blended figures (Cogni). Absent until the split is applied. */
  meta_spend_excluded?: number
  meta_spend_excluded_campaigns?: ExcludedCampaign[]
  /**
   * 'applied'     — meta_spend is blended and meta_spend_excluded is what was left out.
   * 'unavailable' — the split endpoint failed; meta_spend is the view's TOTAL and
   *                 may include Cogni. Not the same as "nothing was excluded".
   */
  spend_split?: 'applied' | 'unavailable'
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
  adset_name?: string | null
  ad_id?: string | null
  ad_name?: string | null
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

// ── Splitting the view's spend ────────────────────────────────────────────────
//
// v_daily_wix_meta_performance returns ONE meta_spend per day: the sum of
// everything Meta spent. On 2026-11-09 COGNI-TEST-09.11 started — a campaign
// whose revenue is in Stripe and never reaches `orders` — and that sum became
// the denominator for Wix orders: CPA 43,16 zł read as 54,12 zł, amber as red.
//
// The view cannot be split after the fact and meta_ads_daily (where campaign
// names live) is closed to the anon key, so the split is made server-side by
// splitAdSpend() and fetched here. This function only APPLIES numbers it was
// handed; it never decides what Cogni is.

type DaySplit = AdSpendSplit & { date: string }

async function fetchSpendSplit(from: string, to: string): Promise<Map<string, DaySplit> | null> {
  try {
    const res = await fetch(
      bustUrl(`/.netlify/functions/spend-split?from=${from}&to=${to}`),
      { headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } },
    )
    if (!res.ok) return null
    const json = await res.json() as { ok: boolean; days?: DaySplit[] }
    if (!json.ok || !Array.isArray(json.days)) return null
    return new Map(json.days.map(d => [d.date, d]))
  } catch {
    return null
  }
}

/**
 * Replace the view's total spend with the blended figure, row by row.
 *
 * Failure is reported, not hidden: if the split cannot be fetched the rows are
 * returned as they came, marked `spend_split: 'unavailable'`, so a consumer can
 * say "the split is unknown" instead of presenting a total that might contain
 * Cogni as if it were blended.
 */
export async function withSpendSplit(rows: DailyPerformance[]): Promise<DailyPerformance[]> {
  if (rows.length === 0) return rows
  const dates = rows.map(r => r.date).sort()
  const days = await fetchSpendSplit(dates[0], dates[dates.length - 1])
  return applySpendSplit(rows, days)
}

export function computeStatus(row: DailyPerformance | null): DataStatus {
  if (!row) return 'NO_DATA'
  // TOTAL, not blended: a day on which only Cogni spent is a day Meta was live.
  const spend = (row.meta_spend ?? 0) + (row.meta_spend_excluded ?? 0)
  const orders = row.wix_orders ?? 0
  if (orders === 0 && spend === 0) return 'NO_DATA'
  if (orders > 0 && spend === 0) return 'META_NOT_LIVE'
  if (spend > 0 && orders === 0) return 'SALES_WARNING'
  return 'OK'
}

export async function fetchTodayPerformance(): Promise<DailyPerformance | null> {
  const today = businessToday()
  const { data, error } = await supabase
    .from('v_daily_wix_meta_performance')
    .select('*')
    .eq('date', today)
    .maybeSingle()

  if (error) {
    console.error('fetchTodayPerformance error', error)
    return null
  }
  if (!data) return null
  const [row] = await withSpendSplit([data as DailyPerformance])
  return row
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
  return withSpendSplit((data ?? []) as DailyPerformance[])
}

// Daily performance rows across a Warsaw date range [from, to] inclusive, oldest→newest.
// Used by the interactive Revenue Trend chart (current period + previous period).
export async function fetchPerformanceBetween(from: string, to: string): Promise<DailyPerformance[]> {
  const { data, error } = await supabase
    .from('v_daily_wix_meta_performance')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .limit(400)

  if (error) {
    console.error('fetchPerformanceBetween error', error)
    return []
  }
  return withSpendSplit((data ?? []) as DailyPerformance[])
}

export async function fetchTopAds(date?: string): Promise<MetaAdDaily[]> {
  const targetDate = date ?? businessToday()
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

// Raw per-ad rows across a Warsaw date range [from, to] inclusive — used for the
// campaign inspector (grouped/aggregated client-side per the selected time range).
export async function fetchAdRowsBetween(from: string, to: string): Promise<MetaAdDaily[]> {
  // limit(1000) sat exactly on PostgREST's cap: a long range would silently
  // return a subset and the inspector would aggregate part of the period as if
  // it were all of it. Paged instead.
  const { rows, error } = await pagedSelect<MetaAdDaily>('meta_ads_daily', {
    order:  { column: 'spend', ascending: false },
    filter: q => q.gte('date', from).lte('date', to),
  })
  if (error) console.error('fetchAdRowsBetween error', error)
  return rows
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
  const today = businessToday()

  // The per-ad read had neither order nor limit, so PostgREST decided both.
  const [{ rows: todayRows }, { data: latestRow }] = await Promise.all([
    pagedSelect<MetaAdDaily>('meta_ads_daily', {
      select: 'date,meta_purchases,purchases',
      order:  { column: 'date', ascending: false },
      filter: q => q.eq('date', today),
    }),
    supabase.from('meta_ads_daily').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
  ])

  const meta_purchases = todayRows.reduce((s, r) => s + (r.meta_purchases ?? r.purchases ?? 0), 0)
  const latestDate = (latestRow as { date?: string } | null)?.date ?? ''
  const isStale = latestDate !== '' && latestDate < today

  return { meta_purchases, latestDate, isStale }
}
