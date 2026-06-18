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

function normalizePl(text: string): string {
  return text
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
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
  if (has(q, 'this week vs', 'week vs last', 'compare week', 'tydzien vs', 'week comparison', 'ten vs zeszly')) return 'this-week-vs-last-week'
  // Individual periods — Polish synonyms normalized (no diacritics)
  if (has(q, 'yesterday', 'wczoraj', 'jak bylo wczoraj', 'jak wczoraj', 'wyniki wczoraj', 'co bylo wczoraj', 'jakie revenue wczoraj', 'what happened yesterday', 'how was yesterday')) return 'yesterday'
  if (has(q, 'this week', 'week so far', 'ten tydzien', 'jak idzie tydzien', 'jak ten tydzien', 'jak tydzien', 'week to date', 'wtd')) return 'this-week'
  if (has(q, 'last week', 'zeszly tydzien', 'poprzedni tydzien', 'ubiegly tydzien')) return 'last-week'
  if (has(q, 'last 7', 'last seven', 'past 7', 'past seven', 'ostatnie 7', 'ostatnich 7', 'ostatni tydzien', '7 days', 'seven days')) return 'last-7-days'
  return null
}



export function resolveIntent(query: string, ctx: IntentContext): string {
  const q = normalizePl(query.toLowerCase().trim())
  const { perf, status, ads, metaStats, jsuSummary, trend } = ctx

  // When today has no data but trend/history is available, give a useful partial briefing
  // rather than saying "no data" for any operational query.
  const isOperationalQuery = has(q,
    'today', 'how are we', 'doing', 'status', 'revenue', 'orders',
    'spend', 'briefing', 'summary', 'dashboard', 'numbers', 'situation',
    'update', 'overview', 'give me', 'tell me', 'read me', 'whats up', "what's up",
    'boss', 'report', 'snapshot',
    // Polish
    'jak idzie', 'co sie dzieje', 'co tam', 'co nowego', 'jak leci',
    'sytuacja', 'dzisiaj', 'dzis', 'hajs', 'zamowien', 'przychod', 'kasa'
  )
  if (status === 'NO_DATA' && trend.length > 0 && isOperationalQuery) {
    // If we have campaign-level ads data for today, we can still give a partial briefing
    if (ads.length > 0) {
      return buildAdsDiagnosis(perf, metaStats, ads)
    }
    const latest = trend[0]
    const lDate  = latest.date
    const orders  = latest.wix_orders ?? 0
    const revenue = latest.wix_revenue ?? 0
    const spend   = latest.meta_spend ?? 0
    const cpa     = latest.real_cpa
    const roas    = latest.real_roas

    const lines = [
      'Wix data is missing for today — Make may not have synced yet, or the day is still early.', '',
      `Latest available data: ${lDate}`,
      `  Orders: ${orders}  |  Revenue: ${revenue.toFixed(2)} PLN  |  Ad spend: ${spend.toFixed(2)} PLN`,
    ]
    if (cpa != null)  lines.push(`  Real CPA: ${cpa.toFixed(2)} PLN`)
    if (roas != null) lines.push(`  Real ROAS: ${roas.toFixed(2)}x`)
    lines.push('', 'Ask: "how was yesterday?" or "last 7 days" for a full picture.')
    return lines.join('\n')
  }

  // JSU / webinar funnel
  if (has(q, 'webinar', 'jsu', 'jak sie ucz', 'jak sie ucz', 'funnel', 'webinary', 'lejek')) {
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
  if (has(q, 'meta vs', 'vs wix', 'compare meta', 'meta wasting', 'wasting money', 'ads working', 'are ads', 'roas', 'attribution', 'discrepancy', 'pixel', 'tracking',
    'meta dzis', 'meta dzisiaj', 'wix dzis', 'wix dzisiaj', 'porownaj meta', 'czy meta')) {
    return buildMetaVsWix(perf, metaStats, ads)
  }

  // Ads diagnosis — "what's wrong with ads / why no sales"
  if (has(q, 'diagnose ads', 'ads not working', "aren't ads", 'ads broken', 'co z reklamami', 'reklamy nie',
    'what\'s wrong with ads', 'whats wrong with ads', 'why no conversions', 'ads problem', 'why no orders',
    'dlaczego brak', 'co z adsami', 'adsy nie', 'adsy dzis', 'adsy dzisiaj', 'co z meta', 'gdzie wycieka')) {
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

  // Campaign/ads detail — underperforming, best, worst, compare
  if (has(q,
    'campaign', 'which ad', 'best ad', 'top ad', 'top campaign', 'which campaign',
    'wasting budget', 'concentration', 'underperform', 'underperforming',
    'worst campaign', 'worst ad', 'compare campaign', 'compare ads',
    'adsy', 'reklamy', 'ktora reklama', 'jakie reklamy', 'przepala', 'slaba kampania',
    'ktora kampania', 'najgorsza', 'jaka reklama')) {
    return buildAdsDiagnosis(perf, metaStats, ads)
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
  if (has(q, 'revenue', 'how much money', 'how much did we make', 'earnings', 'income from',
    'hajs', 'hajsu', 'przychod', 'ile hajsu', 'kasa', 'zarobki', 'ile zarobily')) {
    return buildRevenueReport(perf, status)
  }
  if (has(q, 'how many orders', 'orders today', 'wix orders', 'purchases today', 'sales today',
    'ile zamowien', 'zamowienia', 'zamowien', 'ile sprzedazy')) {
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
  if (has(q, 'how are we', 'doing today', 'give me', 'tell me', 'read me', 'whats up', "what's up", 'update', 'status', 'situation', 'brief', 'briefing', 'summary', 'report', 'ops', 'overview', 'numbers', 'today', 'dashboard', 'snapshot',
    'jak idzie', 'co sie dzieje', 'co tam', 'co nowego', 'jak leci', 'sytuacja', 'dzisiaj', 'dzis')) {
    return buildOpsBriefing(perf, status, metaStats, ads)
  }

  // DEFAULT — never "unknown command": always give the ops briefing
  return buildOpsBriefing(perf, status, metaStats, ads)
}
