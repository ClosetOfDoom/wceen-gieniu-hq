import type { DailyPerformance, DataStatus, MetaAdDaily, MetaStatsToday } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import {
  buildRevenueReport, buildOperationalReport, buildPipelineReport,
  buildCPAThresholds, buildCPAThresholdsLang, buildRedFlags,
  buildCreativesReport, buildRetargetingReport, buildMailRhythm, buildWeeklyPlan,
  buildJsuWebinarReport, buildWhyCourseNotSelling, buildJsuFunnelReport,
  buildCompareJsuWebinars, buildDeliverabilityReport, buildMailingDiagnosis,
  buildAttendanceRateReport, buildWhoAttendedAndBought,
  buildOpsBriefing, buildMetaVsWix,
  buildYesterdaySummary, buildWeekToDate, buildLastWeekSummary,
  buildLast7Days, buildPeriodComparison, buildAdsDiagnosis,
} from './responses'

export interface IntentContext {
  perf: DailyPerformance | null
  status: DataStatus
  ads: MetaAdDaily[]
  metaStats: MetaStatsToday
  jsuSummary: JsuFunnelSummary | null
  trend: DailyPerformance[]
}

function has(text: string, ...terms: string[]): boolean {
  return terms.some(t => text.includes(t))
}

type TimeRange =
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'last-7-days'
  | 'today-vs-yesterday'
  | 'this-week-vs-last-week'

function detectTimeRange(q: string): TimeRange | null {
  // Comparisons first — more specific than individual periods
  if (has(q, 'vs yesterday', 'vs wczoraj', 'today vs', 'dzisiaj vs', 'compare today', 'today against yesterday')) return 'today-vs-yesterday'
  if (has(q, 'this week vs', 'week vs last', 'compare week', 'tydzień vs', 'week comparison', 'ten vs zeszły')) return 'this-week-vs-last-week'
  // Individual periods
  if (has(q, 'yesterday', 'wczoraj', 'jak było wczoraj', 'what happened yesterday', 'how was yesterday')) return 'yesterday'
  if (has(q, 'this week', 'week so far', 'ten tydzień', 'jak idzie tydzień', 'week to date', 'wtd')) return 'this-week'
  if (has(q, 'last week', 'zeszły tydzień', 'poprzedni tydzień', 'ubiegły tydzień')) return 'last-week'
  if (has(q, 'last 7', 'last seven', 'past 7', 'past seven', 'ostatnie 7', 'ostatni tydzień', '7 days', 'seven days')) return 'last-7-days'
  return null
}

function buildCampaignSummary(ads: MetaAdDaily[]): string {
  if (ads.length === 0) return 'No campaign data for today. Make scenarios may not have synced yet.'
  const top   = ads[0]
  const total = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
  const topPct = total > 0 ? ((top.spend / total) * 100).toFixed(0) : '?'
  const concentrated = total > 0 && top.spend / total > 0.7

  const lines = [
    `Top campaign today: "${top.campaign_name ?? top.campaign_id ?? '?'}"`,
    `Spend: ${top.spend.toFixed(2)} PLN (${topPct}% of total budget).`,
    `Clicks: ${top.link_clicks ?? '—'}. Meta-attributed purchases: ${top.purchases ?? 0}.`,
  ]
  if (concentrated) {
    lines.push('\nWarning: this campaign is consuming over 70% of the budget. Concentration risk — no backup if it underperforms.')
  }
  if (ads.length > 1) {
    lines.push('\nOther active campaigns:')
    ads.slice(1, 4).forEach(a => {
      lines.push(`  "${a.campaign_name ?? a.campaign_id}" — ${a.spend.toFixed(2)} PLN`)
    })
  }
  return lines.join('\n')
}

export function resolveIntent(query: string, ctx: IntentContext): string {
  const q = query.toLowerCase().trim()
  const { perf, status, ads, metaStats, jsuSummary, trend } = ctx

  // JSU / webinar funnel
  if (has(q, 'webinar', 'jsu', 'jak się', 'jak sie', 'jak się ucz', 'jak sie ucz', 'funnel')) {
    if (has(q, 'selling', 'not selling', 'not work', 'problem', 'why', 'czemu')) return buildWhyCourseNotSelling(jsuSummary)
    if (has(q, 'compare', 'comparison', 'history', 'historical', 'previous')) return buildCompareJsuWebinars(jsuSummary)
    if (has(q, 'deliver', 'deliverability', 'inbox', 'bounce', 'spam')) return buildDeliverabilityReport(jsuSummary)
    if (has(q, 'mailing crash', 'did the mailing', 'open rate', 'click rate')) return buildMailingDiagnosis(jsuSummary)
    if (has(q, 'attend', 'show up', 'show-up', 'who came', 'turnout')) return buildAttendanceRateReport(jsuSummary)
    if (has(q, 'bought', 'who bought', 'who attended and', 'purchased and')) return buildWhoAttendedAndBought(jsuSummary)
    if (has(q, 'report', 'summary', 'how is', 'how are')) return buildJsuWebinarReport(jsuSummary)
    return buildJsuFunnelReport(jsuSummary)
  }

  // Meta vs Wix / ad efficiency
  if (has(q, 'meta vs', 'vs wix', 'compare meta', 'meta wasting', 'wasting money', 'ads working', 'are ads', 'roas', 'attribution', 'discrepancy', 'pixel', 'tracking')) {
    return buildMetaVsWix(perf, metaStats, ads)
  }

  // Ads diagnosis — "what's wrong with ads / why no sales"
  if (has(q, 'diagnose ads', 'ads not working', "aren't ads", 'ads broken', 'co z reklamami', 'reklamy nie', 'what\'s wrong with ads', 'whats wrong with ads', 'why no conversions', 'ads problem', 'why no orders', 'dlaczego brak')) {
    return buildAdsDiagnosis(perf, metaStats, ads)
  }

  // Time-range queries — must run before generic keywords like "today", "this week"
  {
    const timeRange = detectTimeRange(q)
    if (timeRange === 'today-vs-yesterday')    return buildPeriodComparison(trend, 'today-vs-yesterday')
    if (timeRange === 'this-week-vs-last-week') return buildPeriodComparison(trend, 'this-week-vs-last-week')
    if (timeRange === 'yesterday')             return buildYesterdaySummary(trend)
    if (timeRange === 'this-week')             return buildWeekToDate(trend)
    if (timeRange === 'last-week')             return buildLastWeekSummary(trend)
    if (timeRange === 'last-7-days')           return buildLast7Days(trend)
  }

  // Top campaigns
  if (has(q, 'campaign', 'which ad', 'best ad', 'top ad', 'top campaign', 'which campaign', 'wasting budget', 'concentration')) {
    return buildCampaignSummary(ads)
  }

  // Creatives
  if (has(q, 'creative', 'new video', 'ad creative', 'new image', 'ad content')) {
    return buildCreativesReport()
  }

  // Retargeting
  if (has(q, 'retarget', 'atc', 'add to cart', 'initiate checkout', 'remarketing')) {
    return buildRetargetingReport()
  }

  // Email / mailing rhythm
  if (has(q, 'email rhythm', 'mailing rhythm', 'email calendar', 'mailing schedule', 'email schedule', 'newsletter schedule')) {
    return buildMailRhythm()
  }

  // CPA thresholds (specific)
  if (has(q, 'cpa threshold', 'cpa limit', 'cpa target', 'max cpa', 'cost per acquisition')) {
    return buildCPAThresholds()
  }
  if (has(q, 'language cpa', 'cpa language', 'cpa lang', 'językowy', 'language pack cpa')) {
    return buildCPAThresholdsLang()
  }

  // Pipeline / product flow
  if (has(q, 'pipeline', 'product path', 'funnel map', 'upsell path', 'product flow')) {
    return buildPipelineReport()
  }

  // Weekly checklist
  if (has(q, 'weekly checklist', 'weekly plan', 'this week checklist', 'what this week')) {
    return buildWeeklyPlan()
  }

  // Red flags / what needs attention
  if (has(q, 'flag', 'warning', 'risk', 'alert', 'attention', 'concern', 'watch', 'what needs', 'what\'s wrong', 'whats wrong', 'problem with', 'issue', 'bad news')) {
    return buildRedFlags(perf)
  }

  // Revenue / orders (specific)
  if (has(q, 'revenue', 'how much money', 'how much did we make', 'earnings', 'income from')) {
    return buildRevenueReport(perf, status)
  }
  if (has(q, 'how many orders', 'orders today', 'wix orders', 'purchases today', 'sales today')) {
    return buildRevenueReport(perf, status)
  }

  // Spend / budget (specific)
  if (has(q, 'ad spend', 'meta spend', 'how much did we spend', 'daily budget', 'budget used')) {
    return buildOperationalReport(perf, status)
  }

  // CPA (broad)
  if (has(q, 'cpa', 'cost per')) {
    return buildCPAThresholds()
  }

  // Email (general)
  if (has(q, 'email', 'mailing', 'newsletter', 'subscribers', 'list')) {
    return buildMailRhythm()
  }

  // Full ops briefing — matches any conversational query about status/today
  if (has(q, 'how are we', 'doing today', 'give me', 'tell me', 'read me', 'whats up', "what's up", 'update', 'status', 'situation', 'brief', 'briefing', 'summary', 'report', 'ops', 'overview', 'numbers', 'today', 'dashboard', 'snapshot')) {
    return buildOpsBriefing(perf, status, metaStats, ads)
  }

  // DEFAULT — never "unknown command": always give the ops briefing
  return buildOpsBriefing(perf, status, metaStats, ads)
}
