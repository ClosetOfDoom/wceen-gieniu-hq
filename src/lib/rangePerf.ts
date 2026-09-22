// Resolving the selected time range down to ONE DailyPerformance row.
//
// These lived inside App.tsx. They moved here so the clipboard-export harness
// can drive the REAL aggregation rather than a copy of it: a comparison between
// the report and the cards is only worth anything if both sides ran the same
// function.

import type { DailyPerformance } from '../services/data'
import { rangeDates, type TimeRange } from './timeRange'

export function sumField(rows: DailyPerformance[], f: keyof DailyPerformance): number {
  return rows.reduce((s, r) => s + (Number(r[f] ?? 0) || 0), 0)
}

// Aggregate up to 7 recent days into one DailyPerformance-shaped total.
export function aggregatePerf(rows: DailyPerformance[]): DailyPerformance | null {
  if (rows.length === 0) return null
  const orders  = sumField(rows, 'wix_orders')
  const revenue = sumField(rows, 'wix_revenue')
  const spend   = sumField(rows, 'meta_spend')
  const sorted  = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  return {
    date: `${sorted[0].date} → ${sorted[sorted.length - 1].date}`,
    wix_orders: orders,
    wix_revenue: revenue,
    meta_spend: spend,
    real_cpa:  orders > 0 ? spend / orders : null,
    real_roas: spend > 0 ? revenue / spend : null,
    impressions: sumField(rows, 'impressions'),
    clicks:      sumField(rows, 'clicks'),
    link_clicks: sumField(rows, 'link_clicks'),
    ads_count:   0,
    meta_purchases:      sumField(rows, 'meta_purchases'),
    meta_purchase_value: sumField(rows, 'meta_purchase_value'),
  }
}

// Resolve the performance row for the selected range from today's row + the recent
// daily rows (all Warsaw-tz). Filters by the SAME rangeDates() bounds the campaign
// data uses, so Command Center KPIs and the Campaigns panel can never drift apart.
export function resolveRangePerf(
  range: TimeRange,
  today: DailyPerformance | null,
  rows: DailyPerformance[],
): DailyPerformance | null {
  const { from, to } = rangeDates(range)
  if (range === 'today') {
    // Fall back to the latest available day (stale note shown separately).
    return today ?? (rows.length > 0 ? rows[0] : null)
  }
  if (range === 'yesterday') {
    return rows.find(r => r.date === from) ?? null
  }
  // week / month — aggregate every day inside [from, to]
  return aggregatePerf(rows.filter(r => r.date >= from && r.date <= to))
}
