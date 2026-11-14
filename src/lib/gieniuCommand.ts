// Fetch helper for the gieniu-command Netlify function.
import type { LlmMeta } from '../types'
import { isFinanceQuestion } from '../../netlify/shared/financeIntent.js'

export interface TrendRow {
  date: string
  /** BLENDED — what CPA divides by. */
  meta_spend: number
  /** Kept out of blended (Cogni). */
  meta_spend_excluded?: number
  wix_orders: number
  wix_revenue: number
  real_cpa: number | null
  real_roas: number | null
  meta_purchases?: number | null
  meta_purchase_value?: number | null
}

export interface GieniuCommandContext {
  /**
   * Alarm verdicts from the one rules module (src/lib/alerts.ts), already
   * computed over WHOLE Warsaw days. Stanley reads these instead of grading a
   * single day himself — a one-day CPA is noise, and he used to flag on it.
   */
  alerts?: Array<{ severity: 'red' | 'amber' | 'none'; rule: string; message: string }>
  todayKPIs: {
    wix_orders?: number | null
    wix_revenue?: number | null
    /** BLENDED — what CPA divides by. */
    meta_spend?: number | null
    /** Kept out of blended (Cogni). */
    meta_spend_excluded?: number | null
    /** 'unavailable' = the split could not be fetched, so meta_spend may include Cogni. */
    spend_split?: 'applied' | 'unavailable' | null
    real_cpa?: number | null
    real_roas?: number | null
    date?: string | null
  } | null
  /** Last 7 days from v_daily_wix_meta_performance, newest-first */
  recentTrend?: TrendRow[]
  profitData: {
    ok: boolean
    marginBeforeAds?: number
    /** BLENDED ad spend — profit, CPA and ROAS use this. */
    adSpend?: number
    adSpendTotal?: number | null
    adSpendExcluded?: number
    adSpendExcludedCampaigns?: Array<{ campaign: string; scope: string; spend: number }>
    adSpendSplitAvailable?: boolean | null
    /** 'bez Cogni' when est. profit leaves Cogni's spend out. */
    estimatedProfitBasis?: string | null
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
    ad_name?: string
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
  todayByProduct?: {
    jsu_course:   { count: number; revenue: number }
    jzk_language: { count: number; revenue: number }
    memory_pack:  { count: number; revenue: number }
    unknown:      { count: number }
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
// Finance questions run a tool round-trip plus a long answer on the server, so they get longer.
const FINANCE_TIMEOUT_MS = 28000

export async function fetchGieniuCommand(
  message: string,
  context: GieniuCommandContext,
): Promise<GieniuCommandResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), isFinanceQuestion(message) ? FINANCE_TIMEOUT_MS : TIMEOUT_MS)

  try {
    const res = await fetch('/.netlify/functions/gieniu-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context }),
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
