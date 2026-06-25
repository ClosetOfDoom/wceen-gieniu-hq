// Fetch helper for the gieniu-command Netlify function.
import type { LlmMeta } from '../types'

export interface TrendRow {
  date: string
  meta_spend: number
  wix_orders: number
  wix_revenue: number
  real_cpa: number | null
  real_roas: number | null
  meta_purchases?: number | null
  meta_purchase_value?: number | null
}

export interface GieniuCommandContext {
  todayKPIs: {
    wix_orders?: number | null
    wix_revenue?: number | null
    meta_spend?: number | null
    real_cpa?: number | null
    real_roas?: number | null
    date?: string | null
  } | null
  /** Last 7 days from v_daily_wix_meta_performance, newest-first */
  recentTrend?: TrendRow[]
  profitData: {
    ok: boolean
    marginBeforeAds?: number
    adSpend?: number
    estimatedProfitAfterAds?: number
    estimatedProfitPerOrder?: number | null
    unknownRevenue?: number
    ordersCount?: number
  } | null
  dataHealth: {
    metaFresh: boolean
    wixFresh: boolean
    latestMetaDate: string
    latestWixDate: string
    today: string
  }
  jsuSummary: {
    bottleneck?: string
    diagnosis?: string
    totals?: {
      registered?: number
      attendees?: number
      purchases?: number
      revenue?: number
    }
    rates?: {
      attendance_rate?: number | null
      purchase_rate?: number | null
    }
  } | null
  topCampaigns: {
    name: string
    spend: number
    clicks: number
    link_clicks: number
    impressions: number
    purchases: number
  }[]
  metaEfficiency?: {
    clicks: number
    link_clicks: number
    impressions: number
    spend: number
    ctr: number | null
    cpc: number | null
    cpm: number | null
  } | null
  currentRoute?: string
}

export interface GieniuCommandResult {
  answerText: string
  speechText: string
  intent: string
  confidence: number
  language?: 'en' | 'pl' | 'mixed'
  dataSourcesUsed: string[]
  warnings: string[]
  llm?: LlmMeta
  // Legacy flat fields — kept for backward compat; prefer llm.used / llm.active
  llmUsed?: boolean
  llmProvider?: string
}

const TIMEOUT_MS = 9000

export async function fetchGieniuCommand(
  message: string,
  context: GieniuCommandContext,
  language: 'en' | 'pl' = 'en',
): Promise<GieniuCommandResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch('/.netlify/functions/gieniu-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, language }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => res.status.toString())
      throw new Error(`gieniu-command ${res.status}: ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<GieniuCommandResult>
  } finally {
    clearTimeout(timer)
  }
}
