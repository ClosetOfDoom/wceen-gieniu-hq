// KPI metric registry — the single source of truth for the interactive KPI cards.
//
// Each metric knows how to compute ITS OWN value from the raw per-day components,
// so composite metrics (CPA, ROAS, CTR, CPC, CPM) are always computed PER DAY from
// that day's spend / orders / impressions — never as an average of daily averages.
//   e.g. CPA of a day = that day's meta_spend / that day's wix_orders.
//
// A metric whose components do NOT exist per day (margin/profit is only returned by
// profit-data as one aggregate for the whole range) has no `daily` function and
// declares the `missingField` so the UI can say exactly what is missing instead of
// drawing an empty chart.

import type { DailyPerformance, MetaAdDaily } from '../services/data'

export type MetricUnit = 'pln' | 'num' | 'x' | 'pct'

// Per-campaign aggregate for the single-day (per-campaign) breakdown view.
export interface CampaignAgg {
  campaign: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  meta_purchases: number
  meta_purchase_value: number
}

export interface KpiMetric {
  id: string
  label: string
  unit: MetricUnit
  // Per-day value from a daily-view row. Return null when that day lacks the
  // components (e.g. CPA on a day with 0 orders). Absent => metric has no daily series.
  daily?: (r: DailyPerformance) => number | null
  // Per-campaign value for the DZIŚ / WCZORAJ breakdown. Absent => not splittable
  // per campaign (Wix orders/revenue are not attributed to a Meta campaign).
  campaign?: (c: CampaignAgg) => number | null
  // Human name of the field that would be required but is not available per day/campaign.
  missingField?: string
}

const num = (v: unknown): number => (Number(v ?? 0) || 0)

// ── Registry ────────────────────────────────────────────────────────────────────

export const KPI_METRICS: Record<string, KpiMetric> = {
  // Core (daily view has these directly) ------------------------------------------
  wix_orders: {
    id: 'wix_orders', label: 'Wix Orders', unit: 'num',
    daily: r => num(r.wix_orders),
    missingField: 'zamówienia Wix nie są przypisane do kampanii (brak wix_orders per campaign_id)',
  },
  wix_revenue: {
    id: 'wix_revenue', label: 'Wix Revenue', unit: 'pln',
    daily: r => num(r.wix_revenue),
    missingField: 'przychód Wix nie jest przypisany do kampanii (brak wix_revenue per campaign_id)',
  },
  meta_spend: {
    id: 'meta_spend', label: 'Ad Spend', unit: 'pln',
    daily: r => num(r.meta_spend),
    campaign: c => c.spend,
  },
  // Composite — computed PER DAY from that day's components -------------------------
  real_cpa: {
    id: 'real_cpa', label: 'Real CPA', unit: 'pln',
    daily: r => num(r.wix_orders) > 0 ? num(r.meta_spend) / num(r.wix_orders) : null,
    missingField: 'CPA per kampania wymaga zamówień Wix per kampania (nieprzypisane)',
  },
  real_roas: {
    id: 'real_roas', label: 'Real ROAS', unit: 'x',
    daily: r => num(r.meta_spend) > 0 ? num(r.wix_revenue) / num(r.meta_spend) : null,
    missingField: 'ROAS per kampania wymaga przychodu Wix per kampania (nieprzypisany)',
  },
  // True CPA per day = that day's ad spend / that day's Wix orders (same components,
  // taken straight from the daily view — the honest per-day denominator).
  true_cpa: {
    id: 'true_cpa', label: 'True CPA', unit: 'pln',
    daily: r => num(r.wix_orders) > 0 ? num(r.meta_spend) / num(r.wix_orders) : null,
    missingField: 'CPA per kampania wymaga zamówień Wix per kampania (nieprzypisane)',
  },
  ctr: {
    id: 'ctr', label: 'CTR', unit: 'pct',
    daily: r => num(r.impressions) > 0 ? num(r.link_clicks) / num(r.impressions) * 100 : null,
    campaign: c => c.impressions > 0 ? c.link_clicks / c.impressions * 100 : null,
  },
  cpc: {
    id: 'cpc', label: 'CPC', unit: 'pln',
    daily: r => num(r.clicks) > 0 ? num(r.meta_spend) / num(r.clicks) : null,
    campaign: c => c.clicks > 0 ? c.spend / c.clicks : null,
  },
  cpm: {
    id: 'cpm', label: 'CPM', unit: 'pln',
    daily: r => num(r.impressions) > 0 ? num(r.meta_spend) / num(r.impressions) * 1000 : null,
    campaign: c => c.impressions > 0 ? c.spend / c.impressions * 1000 : null,
  },
  clicks: {
    id: 'clicks', label: 'Total Clicks', unit: 'num',
    daily: r => num(r.clicks),
    campaign: c => c.clicks,
  },
  impressions: {
    id: 'impressions', label: 'Impressions', unit: 'num',
    daily: r => num(r.impressions),
    campaign: c => c.impressions,
  },
  meta_attr: {
    id: 'meta_attr', label: 'Meta Attr.', unit: 'num',
    daily: r => r.meta_purchases != null ? num(r.meta_purchases) : null,
    campaign: c => c.meta_purchases,
  },
  // Margin / profit — profit-data returns ONE aggregate per range, no per-day series.
  est_profit: {
    id: 'est_profit', label: 'Est. Profit', unit: 'pln',
    missingField: 'dzienny Est. Profit — profit-data zwraca tylko sumę zakresu (brak estimatedProfit per day)',
  },
  margin_before_ads: {
    id: 'margin_before_ads', label: 'Margin Before Ads', unit: 'pln',
    missingField: 'dzienna marża (knownMargin per day) — brak w widoku v_daily_wix_meta_performance',
  },
  profit_per_order: {
    id: 'profit_per_order', label: 'Profit / Order', unit: 'pln',
    missingField: 'dzienna marża i zamówienia mapowane per day — profit-data agreguje cały zakres',
  },
  margin_roas: {
    id: 'margin_roas', label: 'Margin ROAS', unit: 'x',
    missingField: 'dzienna marża — profit-data agreguje cały zakres (brak knownMargin per day)',
  },
  unmapped_rev: {
    id: 'unmapped_rev', label: 'Unmapped Revenue', unit: 'pln',
    missingField: 'dzienny przychód nierozpoznany — profit-data agreguje cały zakres (brak unknownRevenue per day)',
  },
  ambiguous_rev: {
    id: 'ambiguous_rev', label: 'Ambiguous Rev.', unit: 'pln',
    missingField: 'dzienny przychód AMBIGUOUS — profit-data agreguje cały zakres (brak ambiguousRevenue per day)',
  },
  unknown_margin_rev: {
    id: 'unknown_margin_rev', label: 'Unknown-margin Rev.', unit: 'pln',
    missingField: 'dzienny przychód WSZTP — profit-data agreguje cały zakres (brak unknownMarginRevenue per day)',
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

export function fmtMetric(unit: MetricUnit, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  switch (unit) {
    case 'pln': return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
    case 'x':   return v.toFixed(2) + '×'
    case 'pct': return v.toFixed(2) + '%'
    default:    return v.toLocaleString('en-US')
  }
}

// Inclusive day span between two YYYY-MM-DD strings (>=1).
export function daySpan(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1
  return Math.max(1, Math.round((b - a) / 86400000) + 1)
}

// Aggregate raw per-ad Meta rows into per-campaign totals.
export function aggregateByCampaign(rows: MetaAdDaily[]): CampaignAgg[] {
  const map = new Map<string, CampaignAgg>()
  for (const r of rows) {
    const key = String(r.campaign_name ?? r.campaign_id ?? '(brak nazwy kampanii)')
    const g = map.get(key) ?? { campaign: key, spend: 0, impressions: 0, clicks: 0, link_clicks: 0, meta_purchases: 0, meta_purchase_value: 0 }
    g.spend            += num(r.spend)
    g.impressions      += num(r.impressions)
    g.clicks           += num(r.clicks)
    g.link_clicks      += num(r.link_clicks)
    g.meta_purchases   += num(r.meta_purchases ?? r.purchases)
    g.meta_purchase_value += num(r.meta_purchase_value)
    map.set(key, g)
  }
  return [...map.values()]
}
