import type { DailyPerformance, DataStatus, MetaAdDaily, MetaStatsToday } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import type { OpsWeekReport } from '../lib/opsWeekReport'
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
  buildWorkflowInstructions,
  buildMemoryBundleAnswer, buildMemoryBundleSpoken,
  buildJsuWeekReport, buildJsuWeekReportSpoken, buildJsuSalesAnswer, buildJsuSalesSpoken,
  buildJzkWeekReport, buildJzkWeekReportSpoken, buildJzkSalesAnswer, buildJzkSalesSpoken,
  // spoken text builders
  buildYesterdaySpoken, buildOpsBriefingSpoken, buildAdsDiagnosisSpoken,
  buildPeriodComparisonSpoken, buildWeekToDateSpoken, buildJsuWebinarSpoken,
  // chart builders
  buildTodayVsYesterdayChart, buildWeekChart, buildLast7Chart,
  buildCampaignChart, buildWebinarFunnelChart,
  // response helpers
  wrapResponse,
  type GieniuResponse, type InsightChartSpec,
} from './responses'

export type { GieniuResponse, InsightChartSpec }

export interface IntentContext {
  perf: DailyPerformance | null
  status: DataStatus
  ads: MetaAdDaily[]
  metaStats: MetaStatsToday
  jsuSummary: JsuFunnelSummary | null
  trend: DailyPerformance[]
  opsWeekReport: OpsWeekReport | null
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
  if (has(q, 'vs yesterday', 'vs wczoraj', 'today vs', 'dzisiaj vs', 'compare today', 'today against yesterday', 'porownaj dzisiaj', 'porownaj dzis', 'porownanie dzisiaj', 'compare dzisiaj')) return 'today-vs-yesterday'
  if (has(q, 'this week vs', 'week vs last', 'compare week', 'tydzien vs', 'week comparison', 'ten vs zeszly')) return 'this-week-vs-last-week'
  if (has(q, 'yesterday', 'wczoraj', 'jak bylo wczoraj', 'jak wczoraj', 'wyniki wczoraj', 'co bylo wczoraj', 'jakie revenue wczoraj', 'what happened yesterday', 'how was yesterday')) return 'yesterday'
  if (has(q, 'this week', 'week so far', 'ten tydzien', 'jak idzie tydzien', 'jak ten tydzien', 'jak tydzien', 'week to date', 'wtd')) return 'this-week'
  if (has(q, 'last week', 'zeszly tydzien', 'poprzedni tydzien', 'ubiegly tydzien')) return 'last-week'
  if (has(q, 'last 7', 'last seven', 'past 7', 'past seven', 'ostatnie 7', 'ostatnich 7', 'ostatni tydzien', '7 days', 'seven days')) return 'last-7-days'
  return null
}

export function resolveIntent(query: string, ctx: IntentContext): GieniuResponse {
  const rawQuery = query
  const q = normalizePl(query.toLowerCase().trim())
  const { perf, status, ads, metaStats, jsuSummary, trend, opsWeekReport } = ctx

  let detectedIntent  = 'ops_briefing'
  let detectedPeriod: string | null = null
  let result: GieniuResponse | null = null

  // Shorthand wrapper
  const w = (d: string, s?: string, c?: InsightChartSpec): GieniuResponse => wrapResponse(d, s, c)

  // ── No data intercept: show latest from trend when today is empty ─────────────
  const isOperationalQuery = has(q,
    'today', 'how are we', 'doing', 'status', 'revenue', 'orders',
    'spend', 'briefing', 'summary', 'dashboard', 'numbers', 'situation',
    'update', 'overview', 'give me', 'tell me', 'read me', 'whats up', "what's up",
    'boss', 'report', 'snapshot',
    'jak idzie', 'co sie dzieje', 'co tam', 'co nowego', 'jak leci',
    'sytuacja', 'dzisiaj', 'dzis', 'hajs', 'zamowien', 'przychod', 'kasa'
  )
  if (status === 'NO_DATA' && trend.length > 0 && isOperationalQuery && !result) {
    if (ads.length > 0) {
      detectedIntent = 'ads_campaign_diagnosis'
      result = w(
        buildAdsDiagnosis(perf, metaStats, ads),
        buildAdsDiagnosisSpoken(perf, metaStats, ads),
        buildCampaignChart(ads),
      )
    } else {
      detectedIntent = 'ops_briefing_stale'
      const latest  = trend[0]
      const lDate   = latest.date
      const orders  = latest.wix_orders  ?? 0
      const revenue = latest.wix_revenue ?? 0
      const spend   = latest.meta_spend  ?? 0
      const cpa     = latest.real_cpa
      const roas    = latest.real_roas
      const lines   = [
        'Wix data is missing for today — Make may not have synced yet, or the day is still early.', '',
        `Latest available data: ${lDate}`,
        `  Orders: ${orders}  |  Revenue: ${revenue.toFixed(2)} PLN  |  Ad spend: ${spend.toFixed(2)} PLN`,
      ]
      if (cpa  != null) lines.push(`  Real CPA: ${cpa.toFixed(2)} PLN`)
      if (roas != null) lines.push(`  Real ROAS: ${roas.toFixed(2)}x`)
      lines.push('', 'Ask: "how was yesterday?" or "last 7 days" for a full picture.')
      const spoken = `No today data yet, Lifidi. Latest from ${lDate}: ${orders} orders, ${revenue.toFixed(0)} Polish zloty revenue, ${spend.toFixed(0)} zloty spend.${cpa != null ? ` C P A was ${cpa.toFixed(0)} zloty.` : ''} Ask me about yesterday or the last 7 days for context.`
      result = w(lines.join('\n'), spoken)
    }
  }

  // ── JSU weekly report ("co bylo w tym tygodniu", "raport tygodnia") ──────────
  // Must be BEFORE webinar_funnel — these queries contain 'jsu'/'webinar' but want week-level data
  if (!result && has(q,
    'co bylo w tym tygodniu', 'co sie dzialo w tym tygodniu', 'raport tygodnia', 'raport tygodniowy',
    'jaki byl ten tydzien', 'jak poszedl ten tydzien', 'jak szedl tydzien', 'podsumowanie tygodnia',
    'summary of the week', 'week report', 'jak poszedl webinar pamieciowy', 'jak poszedl wczorajszy webinar',
    'jak poszedl jsu', 'jak poszedl webinar jsu', 'wyniki webinaru', 'wyniki webinar',
    'wczoraj byl webinar', 'jak bylo na webinarze', 'co bylo na webinarze',
    'ile osob bylo na webinarze', 'ile osob przyszlo na webinar',
  )) {
    detectedIntent = 'jsu_week_report'
    result = w(buildJsuWeekReport(opsWeekReport), buildJsuWeekReportSpoken(opsWeekReport))
  }

  // ── JSU sales query ("ile zeszło JSU", "ile sprzedało JSU") ──────────────────
  // Must be BEFORE webinar_funnel and product_scope handlers — both catch 'jsu'
  if (!result && has(q,
    'ile zeszlo jsu', 'ile sprzedalo jsu', 'ile jsu sprzedano', 'ile sprzedalismy jsu',
    'ile sie sprzedalo jsu', 'ile kursow jsu', 'jsu sprzedaz', 'jsu sales',
    'ile szlo jsu', 'jsu sprzedal', 'ile jsu kupiono', 'ile jsu kupil',
    'ile sprzedano kursow', 'ile kursow sprzedano',
  )) {
    detectedIntent = 'jsu_sales_query'
    result = w(buildJsuSalesAnswer(opsWeekReport), buildJsuSalesSpoken(opsWeekReport))
  }

  // ── JZK sales query ("ile zeszło Językozaka", "ile zeszło JZK") ─────────────
  // 347 PLN = JZK_LANGUAGE absolute rule; answers from jzk_orders
  // Positioned before the JZK week-report handler (which also catches 'jezykozak')
  if (!result && has(q,
    'ile zeszlo jezykozaka', 'ile sprzedalo jezykozaka', 'ile zeszlo jzk',
    'ile sprzedalo jzk', 'ile jzk sprzedano', 'ile jezykozakow', 'ile jezykozak',
    'jzk sprzedaz', 'jzk sales', 'ile jezykozak ai', 'ile zeszlo jezyk ai',
    'sprzedaz jezykozaka', 'wyniki sprzedazy jzk',
  )) {
    detectedIntent = 'jzk_sales_query'
    result = w(buildJzkSalesAnswer(opsWeekReport), buildJzkSalesSpoken(opsWeekReport))
  }

  // ── JZK (Językozak AI) weekly report ─────────────────────────────────────────
  // Must be BEFORE webinar_funnel — 'jzk'/'jezyk'/'jezykozak' otherwise hit it
  if (!result && has(q,
    'jezykozak', 'jzk raport', 'jzk tydzien', 'jzk week', 'jak poszedl jezykozak',
    'jak poszedl jzk', 'ile bylo na jezykozaku', 'ile bylo na jzk',
    'wyniki jezykozaka', 'wyniki jzk', 'jezykozak tydzien',
    'language webinar', 'tuesday webinar', 'wtorek webinar',
  )) {
    detectedIntent = 'jzk_week_report'
    result = w(buildJzkWeekReport(opsWeekReport), buildJzkWeekReportSpoken(opsWeekReport))
  }

  // ── JSU / webinar funnel ──────────────────────────────────────────────────────
  if (!result && has(q, 'webinar', 'jsu', 'jak sie ucz', 'funnel', 'webinary', 'lejek', 'clickmeeting')) {
    detectedIntent = 'webinar_funnel'
    if (has(q, 'selling', 'not selling', 'not work', 'problem', 'why', 'czemu')) {
      result = w(buildWhyCourseNotSelling(jsuSummary), buildJsuWebinarSpoken(jsuSummary), buildWebinarFunnelChart(jsuSummary))
    } else if (has(q, 'compare', 'comparison', 'history', 'historical', 'previous')) {
      result = w(buildCompareJsuWebinars(jsuSummary), buildJsuWebinarSpoken(jsuSummary))
    } else if (has(q, 'deliver', 'deliverability', 'inbox', 'bounce', 'spam')) {
      result = w(buildDeliverabilityReport(jsuSummary))
    } else if (has(q, 'mailing crash', 'did the mailing', 'open rate', 'click rate')) {
      result = w(buildMailingDiagnosis(jsuSummary))
    } else if (has(q, 'attend', 'show up', 'show-up', 'who came', 'turnout', 'frekwencja')) {
      result = w(buildAttendanceRateReport(jsuSummary))
    } else if (has(q, 'bought', 'who bought', 'who attended and', 'purchased and')) {
      result = w(buildWhoAttendedAndBought(jsuSummary))
    } else if (has(q, 'report', 'summary', 'how is', 'how are')) {
      result = w(buildJsuWebinarReport(jsuSummary), buildJsuWebinarSpoken(jsuSummary), buildWebinarFunnelChart(jsuSummary))
    } else {
      result = w(buildJsuFunnelReport(jsuSummary), buildJsuWebinarSpoken(jsuSummary), buildWebinarFunnelChart(jsuSummary))
    }
  }

  // ── Meta vs Wix / ad efficiency ───────────────────────────────────────────────
  if (!result && has(q, 'meta vs', 'vs wix', 'compare meta', 'meta wasting', 'ads working', 'are ads', 'roas', 'attribution', 'discrepancy', 'pixel', 'tracking',
    'meta dzis', 'meta dzisiaj', 'wix dzis', 'wix dzisiaj', 'porownaj meta', 'czy meta')) {
    detectedIntent = 'meta_vs_wix'
    result = w(buildMetaVsWix(perf, metaStats, ads), buildAdsDiagnosisSpoken(perf, metaStats, ads), buildCampaignChart(ads))
  }

  // ── Ads diagnosis ─────────────────────────────────────────────────────────────
  if (!result && has(q, 'diagnose ads', 'ads not working', "aren't ads", 'ads broken', 'co z reklamami', 'reklamy nie',
    "what's wrong with ads", 'whats wrong with ads', 'why no conversions', 'ads problem', 'why no orders',
    'dlaczego brak', 'co z adsami', 'adsy nie', 'adsy dzis', 'adsy dzisiaj', 'co z meta', 'gdzie wycieka',
    'which ad', 'best ad', 'top ad', 'top campaign', 'which campaign', 'underperform', 'underperforming',
    'worst campaign', 'worst ad', 'compare campaign', 'compare ads', 'adsy', 'reklamy', 'ktora reklama',
    'jakie reklamy', 'przepala', 'slaba kampania', 'ktora kampania', 'najgorsza', 'jaka reklama',
    'wasting money', 'wasting budget', 'waste money', 'waste budget', 'what is wasting', "what's wasting",
    'co przepala', 'przepala budzet', 'marnotrawi', 'co marnuje')) {
    detectedIntent = 'ads_campaign_diagnosis'
    result = w(buildAdsDiagnosis(perf, metaStats, ads), buildAdsDiagnosisSpoken(perf, metaStats, ads), buildCampaignChart(ads))
  }

  // ── Time-range queries ────────────────────────────────────────────────────────
  if (!result) {
    const timeRange = detectTimeRange(q)
    if (timeRange) {
      detectedPeriod = timeRange
      if (timeRange === 'today-vs-yesterday') {
        detectedIntent = 'period_comparison'
        result = w(
          buildPeriodComparison(trend, 'today-vs-yesterday'),
          buildPeriodComparisonSpoken(trend, 'today-vs-yesterday'),
          buildTodayVsYesterdayChart(trend),
        )
      } else if (timeRange === 'this-week-vs-last-week') {
        detectedIntent = 'period_comparison'
        result = w(
          buildPeriodComparison(trend, 'this-week-vs-last-week'),
          buildPeriodComparisonSpoken(trend, 'this-week-vs-last-week'),
          buildWeekChart(trend),
        )
      } else if (timeRange === 'yesterday') {
        detectedIntent = 'yesterday_summary'
        result = w(buildYesterdaySummary(trend), buildYesterdaySpoken(trend))
      } else if (timeRange === 'this-week') {
        detectedIntent = 'week_summary'
        result = w(buildWeekToDate(trend), buildWeekToDateSpoken(trend), buildWeekChart(trend))
      } else if (timeRange === 'last-week') {
        detectedIntent = 'last_week_summary'
        result = w(buildLastWeekSummary(trend))
      } else if (timeRange === 'last-7-days') {
        detectedIntent = 'last_7_days'
        result = w(buildLast7Days(trend), undefined, buildLast7Chart(trend))
      }
    }
  }

  // ── Campaign query that doesn't match ads-diagnosis above (catch-all "campaign") ─
  if (!result && has(q, 'campaign', 'wasting budget', 'concentration')) {
    detectedIntent = 'ads_campaign_diagnosis'
    result = w(buildAdsDiagnosis(perf, metaStats, ads), buildAdsDiagnosisSpoken(perf, metaStats, ads), buildCampaignChart(ads))
  }

  // ── Workflow / next steps ─────────────────────────────────────────────────────
  if (!result && has(q,
    'what should i do', 'what to do', 'next move', 'next step', 'next steps',
    'workflow', 'give me workflow', 'plan next', 'action plan', 'plan of action',
    'co robic', 'co teraz robic', 'jakie kroki', 'co dalej', 'plan dzialan'
  )) {
    detectedIntent = 'workflow_advisor'
    result = w(buildWorkflowInstructions(perf, status, ads, metaStats))
  }

  // ── Red flags ────────────────────────────────────────────────────────────────
  if (!result && has(q, 'flag', 'warning', 'risk', 'alert', 'attention', 'concern', 'watch', 'what needs',
    "what's wrong", 'whats wrong', 'problem with', 'issue', 'bad news')) {
    detectedIntent = 'red_flags'
    result = w(buildRedFlags(perf))
  }

  // ── Memory bundle / product-scope queries ──────────────────────────────────────
  // NEVER route to ops_briefing for product-specific queries — there is no product data
  if (!result && has(q,
    'memory bundle', 'memory pack', 'memory kit', 'memory orders',
    'pakiet pamieci', 'pakiet pamieciowy', 'ile pakietow pamieci', 'ile pakietow pamieciowych',
    'ile sprzedalo pamieci', 'ile sprzedal pamieci', 'ile sprzedalismy pamieci', 'ile sprzedano pamieci',
    'ile pakietow sprzedano', 'ile pakietow sprzedal', 'ile pakietow sprzedalismy',
    'product scope', 'product breakdown', 'product split', 'po produkcie',
    'ile memory', 'ile jzk', 'ile jsu', 'ile kursu', 'ile produktow'
  )) {
    detectedIntent = 'memory_product_scope'
    result = w(buildMemoryBundleAnswer(perf, status), buildMemoryBundleSpoken(perf))
  }

  // ── Revenue / orders ─────────────────────────────────────────────────────────
  if (!result && has(q, 'revenue', 'how much money', 'how much did we make', 'earnings', 'income from',
    'hajs', 'hajsu', 'przychod', 'ile hajsu', 'kasa', 'zarobki', 'ile zarobily')) {
    detectedIntent = 'revenue_report'
    result = w(buildRevenueReport(perf, status))
  }
  if (!result && has(q, 'how many orders', 'orders today', 'wix orders', 'purchases today', 'sales today',
    'ile zamowien', 'zamowienia', 'zamowien', 'ile sprzedazy')) {
    detectedIntent = 'orders_report'
    result = w(buildRevenueReport(perf, status))
  }

  // ── Spend / budget ────────────────────────────────────────────────────────────
  if (!result && has(q, 'ad spend', 'meta spend', 'how much did we spend', 'daily budget', 'budget used')) {
    detectedIntent = 'ops_report'
    result = w(buildOperationalReport(perf, status))
  }

  // ── CPA thresholds ────────────────────────────────────────────────────────────
  if (!result && has(q, 'cpa threshold', 'cpa limit', 'cpa target', 'max cpa', 'cost per acquisition')) {
    detectedIntent = 'cpa_thresholds'
    result = w(buildCPAThresholds())
  }
  if (!result && has(q, 'language cpa', 'cpa language', 'cpa lang', 'jezykowy', 'language pack cpa')) {
    detectedIntent = 'cpa_thresholds_lang'
    result = w(buildCPAThresholdsLang())
  }
  if (!result && has(q, 'cpa', 'cost per')) {
    detectedIntent = 'cpa_thresholds'
    result = w(buildCPAThresholds())
  }

  // ── Creatives ────────────────────────────────────────────────────────────────
  if (!result && has(q, 'creative', 'new video', 'ad creative', 'new image', 'ad content')) {
    detectedIntent = 'creatives'
    result = w(buildCreativesReport())
  }

  // ── Retargeting ──────────────────────────────────────────────────────────────
  if (!result && has(q, 'retarget', 'atc', 'add to cart', 'initiate checkout', 'remarketing')) {
    detectedIntent = 'retargeting'
    result = w(buildRetargetingReport())
  }

  // ── Email rhythm ─────────────────────────────────────────────────────────────
  if (!result && has(q, 'email rhythm', 'mailing rhythm', 'email calendar', 'mailing schedule', 'email schedule', 'newsletter schedule')) {
    detectedIntent = 'email_rhythm'
    result = w(buildMailRhythm())
  }
  if (!result && has(q, 'email', 'mailing', 'newsletter', 'subscribers', 'list')) {
    detectedIntent = 'email_rhythm'
    result = w(buildMailRhythm())
  }

  // ── Pipeline ─────────────────────────────────────────────────────────────────
  if (!result && has(q, 'pipeline', 'product path', 'funnel map', 'upsell path', 'product flow')) {
    detectedIntent = 'pipeline'
    result = w(buildPipelineReport())
  }

  // ── Weekly checklist ─────────────────────────────────────────────────────────
  if (!result && has(q, 'weekly checklist', 'weekly plan', 'this week checklist', 'what this week')) {
    detectedIntent = 'weekly_plan'
    result = w(buildWeeklyPlan())
  }

  // ── General ops / dashboard ───────────────────────────────────────────────────
  if (!result && has(q, 'how are we', 'doing today', 'give me', 'tell me', 'read me', 'whats up', "what's up",
    'update', 'status', 'situation', 'brief', 'briefing', 'summary', 'report', 'ops', 'overview', 'numbers',
    'today', 'dashboard', 'snapshot', 'jak idzie', 'co sie dzieje', 'co tam', 'co nowego', 'jak leci',
    'sytuacja', 'dzisiaj', 'dzis', 'boss')) {
    detectedIntent = 'ops_briefing'
    result = w(buildOpsBriefing(perf, status, metaStats, ads), buildOpsBriefingSpoken(perf, status, metaStats, ads))
  }

  // ── DEFAULT — always ops briefing ────────────────────────────────────────────
  if (!result) {
    detectedIntent = 'ops_briefing'
    result = w(buildOpsBriefing(perf, status, metaStats, ads), buildOpsBriefingSpoken(perf, status, metaStats, ads))
  }

  // eslint-disable-next-line no-console
  console.log('GIENIU intent route', { rawQuery, normalizedQuery: q, detectedIntent, detectedPeriod, builderUsed: detectedIntent })

  return result
}
