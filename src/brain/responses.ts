import type { DailyPerformance, DataStatus, MetaAdDaily, MetaStatsToday } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { pct } from '../services/webinarFunnel'
import { normalizeProduct, productFromQuery, type ProductTag } from '../lib/webinarProduct'
import {
  pickPhrase,
  OPENERS, GOOD_VERDICTS, HIGH_CPA_VERDICTS, SALES_WARNING_VERDICTS,
  NO_DATA_VERDICTS, NEXT_MOVES, META_NOT_LIVE_NOTES,
  JSU_OPENERS, JSU_BOTTLENECK_CLOSES, JSU_OK_CLOSES,
} from './personality'
import { yesterdayWaw, thisWeekStartWaw, lastWeekStartWaw, lastWeekEndWaw } from './timeParser'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0, suffix = ''): string {
  if (n == null) return '—'
  return n.toFixed(decimals) + suffix
}

function fmtPln(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + ' PLN'
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

function statusLabel(s: DataStatus): string {
  switch (s) {
    case 'OK':            return 'OK'
    case 'META_NOT_LIVE': return 'META NOT LIVE'
    case 'SALES_WARNING': return 'SALES WARNING'
    case 'NO_DATA':       return 'NO DATA'
  }
}

// ── Response types ────────────────────────────────────────────────────────────

export interface InsightChartSpec {
  type: 'bar' | 'line' | 'funnel'
  title: string
  xKey: string
  data: Array<Record<string, string | number | null>>
  series: Array<{ key: string; label: string; color?: string }>
}

export interface GieniuResponse {
  displayText: string
  spokenText: string
  chart?: InsightChartSpec
}

export function wrapResponse(displayText: string, spokenText?: string, chart?: InsightChartSpec): GieniuResponse {
  return { displayText, spokenText: spokenText ?? toSpokenText(displayText), chart }
}

export function toSpokenText(text: string): string {
  return text
    // Remove "— ALL CAPS HEADING —" lines
    .replace(/^—[^—\n]+—\s*$/gm, '')
    // Convert " | " pipe separators to ". "
    .replace(/\s*\|\s*/g, '. ')
    // Strip leading indentation markers
    .replace(/^\s{2,}/gm, '')
    // Expand abbreviations
    .replace(/\bCPA\b/g, 'C P A')
    .replace(/\bROAS\b/g, 'R O A S')
    .replace(/\bJSU\b/g, 'Jak się uczyć')
    .replace(/\bJZK\b/g, 'Językozak')
    // "123.45 PLN" → "123 Polish zloty"
    .replace(/(\d+\.?\d*)\s*PLN\b/g, (_, n) => `${parseFloat(n).toFixed(0)} Polish zloty`)
    // "1.72x" → "1.72"
    .replace(/(\d\.\d+)x\b/g, '$1')
    // Standalone dashes
    .replace(/\s—\s/g, ', ')
    .replace(/^—\s*/gm, '')
    // Collapse newlines to natural pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\.\s*\.\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── JSU command type ──────────────────────────────────────────────────────────

export type JsuCommandKey =
  | 'webinar jak się uczyć'
  | 'czemu kurs się nie sprzedaje'
  | 'funnel JSU'
  | 'porównaj webinary JSU'
  | 'deliverability'
  | 'czy mailing siadł'
  | 'attendance rate'
  | 'kto był i kupił'

// ── Dashboard builders ────────────────────────────────────────────────────────

export function buildRevenueReport(
  perf: DailyPerformance | null,
  status: DataStatus
): string {
  const opener = pickPhrase(OPENERS)
  const nextMove = pickPhrase(NEXT_MOVES)

  if (status === 'NO_DATA') {
    return `${opener}\n\n${pickPhrase(NO_DATA_VERDICTS)}\n\nNext move: check Make scenarios in the automation panel.`
  }

  const orders = perf?.wix_orders ?? 0
  const revenue = perf?.wix_revenue ?? 0
  const spend = perf?.meta_spend ?? 0
  const cpa = perf?.real_cpa ?? null
  const roas = perf?.real_roas ?? null

  let verdict = ''
  if (status === 'META_NOT_LIVE') {
    verdict = pickPhrase(META_NOT_LIVE_NOTES)
  } else if (status === 'SALES_WARNING') {
    verdict = pickPhrase(SALES_WARNING_VERDICTS)
  } else if (cpa && cpa > 50) {
    verdict = pickPhrase(HIGH_CPA_VERDICTS)
  } else {
    verdict = pickPhrase(GOOD_VERDICTS)
  }

  const lines = [
    opener,
    '',
    verdict,
    '',
    `Wix orders: ${orders}`,
    `Wix revenue: ${fmtPln(revenue)}`,
    `Meta ad spend: ${fmtPln(spend)}`,
    `Real CPA: ${cpa != null ? fmtPln(cpa) : '—'}`,
    `Real ROAS: ${roas != null ? fmt(roas, 2, 'x') : '—'}`,
    '',
    `Next move: ${nextMove}`,
  ]

  return lines.join('\n')
}

export function buildOperationalReport(
  perf: DailyPerformance | null,
  status: DataStatus
): string {
  const opener = pickPhrase(OPENERS)
  if (!perf || status === 'NO_DATA') {
    return `${opener}\n\nNo operational data for today. Check Make and the Supabase connection.`
  }

  const lines = [
    opener,
    '',
    '— OPERATIONAL REPORT —',
    '',
    `Wix orders: ${perf.wix_orders}`,
    `Revenue: ${fmtPln(perf.wix_revenue)}`,
    `Meta ad spend: ${fmtPln(perf.meta_spend)}`,
    `Impressions: ${fmtNum(perf.impressions)}`,
    `Link clicks: ${fmtNum(perf.link_clicks)}`,
    `Real CPA: ${perf.real_cpa != null ? fmtPln(perf.real_cpa) : '—'}`,
    `Real ROAS: ${perf.real_roas != null ? fmt(perf.real_roas, 2, 'x') : '—'}`,
    `Active ads: ${perf.ads_count ?? '—'}`,
    '',
    `Status: ${statusLabel(status)}`,
  ]
  return lines.join('\n')
}

export function buildPipelineReport(): string {
  const opener = pickPhrase(OPENERS)
  return `${opener}

— WCEEN PIPELINE —

Memory path:
  Meta Ads → Memory Pack 119 PLN → onboarding email → webinar "Jak się uczyć" (Thu 18:00) → course 549 PLN → WSZTP

Language path:
  Meta Ads → Language Pack 114 PLN → onboarding email → webinar Językozak AI (Tue 18:00) → Językozak AI → WSZTP

CPA thresholds — Memory: target max 40 PLN / alert 50 PLN / stop 60 PLN
CPA thresholds — Language: target 20–25 PLN / alert 30–35 PLN / break-even 40 PLN

Active list: ~5,000 contacts. Segment or do not email them.`
}

export function buildCPAThresholds(): string {
  return `${pickPhrase(OPENERS)}

— CPA THRESHOLDS — MEMORY PACK —
Target: max 40 PLN
Alert: above 50 PLN
Do not scale: above 60 PLN
Loss territory: above 70 PLN (unless LTV justifies it)

Net profit formula:
Number of purchases × 70 PLN − Meta ad spend = net profit after ads`
}

export function buildCPAThresholdsLang(): string {
  return `${pickPhrase(OPENERS)}

— CPA THRESHOLDS — LANGUAGE PACK —
Target: 20–25 PLN
Alert: 30–35 PLN
Break-even: 40 PLN
Above 40 PLN: loss on the front end

Language Pack is an entry product. Goal: close on Językozak AI.`
}

export function buildRedFlags(perf: DailyPerformance | null): string {
  const flags: string[] = []

  if (!perf) {
    return `${pickPhrase(OPENERS)}\n\nNo data — cannot assess flags. Check Make.`
  }

  const cpa = perf.real_cpa ?? 0
  const spend = perf.meta_spend ?? 0
  const orders = perf.wix_orders ?? 0
  const lc = perf.link_clicks ?? 0

  if (cpa > 50) flags.push('Memory Pack CPA is above 50 PLN')
  if (spend > 0 && orders === 0) flags.push('Heavy ad spend, zero orders — check the funnel')
  if (lc > 0 && orders === 0) flags.push('Link clicks exist, no purchases — check the landing page')
  if (perf.ads_count === 1) flags.push('Only one active ad — no backup plan')

  if (flags.length === 0) {
    return `${pickPhrase(OPENERS)}\n\nNo drama yet. But I am watching the funnel.`
  }

  return `${pickPhrase(OPENERS)}\n\n— RED FLAGS —\n\n${flags.map(f => `⚠ ${f}`).join('\n')}`
}

export function buildCreativesReport(): string {
  return `${pickPhrase(OPENERS)}

— CREATIVES — minimum active —

Memory Pack: 3 videos + 2 images + 1 advertorial
Language Pack: 3 videos + 2 images + 1 advertorial or quiz

Memory angles:
  1. School lied to you
  2. Your brain is not weak
  3. Memorize X pieces of information fast
  4. The biggest learning mistake
  5. Memory test

Language angles:
  1. You do not have a language problem. You have a method problem.
  2. Vocabulary does not have to keep falling out of your head
  3. Language as a game, not a punishment
  4. Bridge to Językozak AI

No new creatives in 7+ days = red flag.`
}

export function buildRetargetingReport(): string {
  return `${pickPhrase(OPENERS)}

— RETARGETING —

Segments:
  • View Content: 7 / 14 / 30 days
  • Add To Cart: 7 / 14 days
  • Initiate Checkout: 7 / 14 days
  • Engagers: 30 / 60 / 90 days
  • Buyers: 180 days

Upsell funnel:
  Memory Pack → webinar "Jak się uczyć"
  Course "Jak się uczyć" → WSZTP
  Language Pack → Językozak AI
  Językozak AI → WSZTP / other programs

ATC and IC must have separate ad sets.`
}

export function buildMailRhythm(): string {
  return `${pickPhrase(OPENERS)}

— MAILING RHYTHM —

Mon: education / story / problem of the week
Tue: Językozak AI — webinar invitation 18:00
Wed: Tuesday follow-up / JZK sale / case study / replay
Thu: webinar "Jak się uczyć" 18:00
Fri: Thursday follow-up / course sale / bridge to WSZTP
Weekend: storytelling / social proof / WCEEN values

Control question: Which segment are we writing to, and what is the next logical step for that person?`
}

export function buildWeeklyPlan(): string {
  return `${pickPhrase(OPENERS)}

— WEEKLY CHECKLIST —

Every week must include:
  ✓ Tuesday 18:00 — Językozak AI webinar
  ✓ Thursday 18:00 — "Jak się uczyć" webinar
  ✓ Min. 1 new creative (video or image)
  ✓ Segmented mailing to the list
  ✓ CPA check for Memory Pack and Language Pack
  ✓ ATC/IC retargeting active
  ✓ Operational report Monday morning

Overriding rule: Does this increase profit, lower CPA, or move the customer closer to the higher-priced product?`
}

// ── JSU Webinar Funnel builders ───────────────────────────────────────────────

function noJsuData(what: string): string {
  return `${pickPhrase(JSU_OPENERS)}\n\n${what}\n\nConnect Make scenarios first — see docs/clickmeeting_make_scenarios.md.`
}

export function buildJsuWebinarReport(s: JsuFunnelSummary | null): string {
  if (!s || s.bottleneck === 'NO_DATA') {
    return noJsuData('No JSU webinar data in Supabase.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const close = s.bottleneck === 'OK' ? pickPhrase(JSU_OK_CLOSES) : pickPhrase(JSU_BOTTLENECK_CLOSES)

  const lines = [
    opener,
    '',
    '— WEBINAR "JAK SIĘ UCZYĆ" —',
    '',
    `Sessions in history: ${s.sessions.length}`,
    `Emails sent: ${s.hasEmailData ? fmtNum(s.totals.email_sent) : 'no ESP data'}`,
    `Delivered: ${s.hasEmailData ? fmtNum(s.totals.email_delivered) : '—'} (${pct(s.rates.delivery_rate)})`,
    `Opens: ${s.hasEmailData ? fmtNum(s.totals.email_opens) : '—'} (OR: ${pct(s.rates.open_rate)})`,
    `Clicks: ${s.hasEmailData ? fmtNum(s.totals.email_clicks) : '—'} (CTR: ${pct(s.rates.click_rate)})`,
    `Webinar registrations: ${s.hasClickMeetingData ? fmtNum(s.totals.registered) : 'no ClickMeeting data'}`,
    `Live attendees: ${s.hasClickMeetingData ? fmtNum(s.totals.attendees) : '—'} (show-up: ${pct(s.rates.attendance_rate)})`,
    `Purchases (7d): ${s.totals.purchases} (conversion: ${pct(s.rates.purchase_rate)})`,
    `Revenue (7d): ${fmtPln(s.totals.revenue)}`,
    '',
    `Diagnosis: ${s.diagnosis}`,
    '',
    close,
  ]
  return lines.join('\n')
}

export function buildWhyCourseNotSelling(s: JsuFunnelSummary | null): string {
  if (!s || s.bottleneck === 'NO_DATA') {
    return noJsuData('No complete funnel data — diagnosis not possible.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const missing: string[] = []
  if (!s.hasEmailData) missing.push('No email data yet — cannot diagnose deliverability.')
  if (!s.hasClickMeetingData) missing.push('No ClickMeeting data yet — cannot diagnose registrations or attendance.')

  const lines = [
    opener,
    '',
    '— WHY IS "JAK SIĘ UCZYĆ" NOT SELLING? —',
    '',
  ]
  if (missing.length) lines.push(...missing, '')
  lines.push(
    `Bottleneck: ${s.bottleneck}`,
    '',
    s.diagnosis,
  )
  if (s.bottleneck === 'OK') {
    lines.push(
      '',
      'Possible causes when funnel metrics are clean:',
      '  1. Memory Pack buyers have already bought the course — no new candidates.',
      '  2. No new traffic into the funnel (Meta Ads → PP paused or low spend).',
      '  3. Webinar offer not communicated in the 24/48/72h follow-up sequence.',
      '  4. Seasonality or conflict with another event.',
    )
  }
  return lines.join('\n')
}

export function buildJsuFunnelReport(s: JsuFunnelSummary | null): string {
  if (!s || s.sessions.length === 0) {
    return noJsuData('No JSU sessions in webinar_sessions table.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const recent3 = s.sessions.slice(0, 3)
  const lines = [
    opener,
    '',
    '— JSU FUNNEL — recent webinars —',
  ]
  for (const sess of recent3) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    lines.push(
      '',
      `Webinar ${date}:`,
      `  Delivered: ${sess.email_delivered > 0 ? fmtNum(sess.email_delivered) : 'no data'} emails`,
      `  Show-up: ${sess.attendee_count}/${sess.registered_count} (${sess.attendance_rate_pct ?? '—'}%)`,
      `  Purchases: ${sess.purchases}, revenue: ${fmtPln(sess.revenue)}`,
    )
  }
  lines.push('', `Diagnosis: ${s.diagnosis}`)
  return lines.join('\n')
}

export function buildCompareJsuWebinars(s: JsuFunnelSummary | null): string {
  if (!s || s.sessions.length < 2) {
    return noJsuData('Not enough JSU sessions to compare (minimum 2).')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const lines = [opener, '', '— JSU WEBINAR COMPARISON —']
  for (const sess of s.sessions.slice(0, 6)) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
    const attend = sess.attendance_rate_pct != null ? sess.attendance_rate_pct + '%' : '—'
    const conv   = sess.purchase_rate_pct != null ? sess.purchase_rate_pct + '%' : '—'
    lines.push(`  ${date}  show-up: ${attend.padEnd(6)}  conv: ${conv.padEnd(6)}  sales: ${sess.purchases}  revenue: ${fmtPln(sess.revenue)}`)
  }
  lines.push('', `Bottleneck: ${s.bottleneck}`)
  return lines.join('\n')
}

export function buildDeliverabilityReport(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasEmailData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNo email data yet — cannot diagnose deliverability.\nConnect Make → ESP → Supabase (email_campaigns table).`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const delivRate = s.rates.delivery_rate
  const openRate  = s.rates.open_rate
  const isOk = delivRate != null && delivRate >= 0.85

  const lines = [
    opener,
    '',
    '— JSU EMAIL DELIVERABILITY —',
    '',
    `Sent: ${fmtNum(s.totals.email_sent)}`,
    `Delivered: ${fmtNum(s.totals.email_delivered)} (${pct(delivRate)})`,
    `Opens: ${fmtNum(s.totals.email_opens)} (OR: ${pct(openRate)})`,
    '',
    isOk
      ? 'Deliverability OK — above 85%. Problem lies elsewhere.'
      : 'Deliverability below 85% — check SPF/DKIM/DMARC, hard bounces, and sender domain reputation.',
  ]
  return lines.join('\n')
}

export function buildMailingDiagnosis(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasEmailData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNo JSU mailing data. Connect Make → ESP → Supabase.`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const or = s.rates.open_rate
  const cr = s.rates.click_rate
  const dr = s.rates.delivery_rate

  const verdict = (() => {
    if (dr !== null && dr < 0.85) return 'MAILING CRASHED — deliverability problem. Check the domain and the list.'
    if (or !== null && or < 0.15) return 'Open rate too low — subject line is weak or emails are landing in spam / promotions.'
    if (cr !== null && cr < 0.02) return 'Click rate too low — the CTA in the email is not working. Rewrite the copy or layout.'
    return 'Mailing looks OK. Problem lies further down the funnel.'
  })()

  return [
    opener, '',
    '— DID THE JSU MAILING CRASH? —', '',
    `Delivery rate: ${pct(dr)}`,
    `Open rate: ${pct(or)}`,
    `Click rate: ${pct(cr)}`,
    '', verdict,
  ].join('\n')
}

export function buildAttendanceRateReport(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasClickMeetingData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNo ClickMeeting data yet — cannot diagnose registrations or attendance.\nConnect Make → ClickMeeting → Supabase (webinar_sessions, webinar_participants).`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const ar = s.rates.attendance_rate
  const attendancePopulated = (s._debug?.attendanceStatus === 'populated') || s.totals.attendees > 0

  let verdict: string
  if (!attendancePopulated && s.totals.registered > 0) {
    verdict = `${s.totals.registered} registration${s.totals.registered > 1 ? 's' : ''} found. Attendance data is not populated yet — the attended column has not been filled in from ClickMeeting. This may mean the webinar has not taken place yet, or Make has not synced the attend status.`
  } else if (ar !== null && ar < 0.60) {
    verdict = `Show-up rate is ${pct(ar)} — below 60%. Check the reminder sequence: email 24h + 1h before. Thursday 18:00 is a solid slot, but reminders can lift attendance.`
  } else {
    verdict = `Show-up rate is ${pct(ar)} — ${ar != null ? 'OK, above 60%.' : 'not enough data to compare.'}`
  }

  const lines = [opener, '', '— JSU ATTENDANCE RATE —', '']
  for (const sess of s.sessions.slice(0, 5)) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
    const attendDisplay = attendancePopulated
      ? `${sess.attendee_count}/${sess.registered_count}  (${sess.attendance_rate_pct ?? '—'}%)`
      : `${sess.registered_count} registered  (attendance not populated)`
    lines.push(`  ${date}  ${attendDisplay}`)
  }
  lines.push('', verdict)
  return lines.join('\n')
}

export function buildWhoAttendedAndBought(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasClickMeetingData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNo ClickMeeting data.\nConnect Make → ClickMeeting → webinar_participants in Supabase.`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const attendancePopulated = (s._debug?.attendanceStatus === 'populated') || s.totals.attendees > 0
  const purchasesMapped     = (s._debug?.purchaseMappingStatus === 'mapped') || s.totals.purchases > 0

  const lines = [opener, '', '— WHO ATTENDED AND BOUGHT — JSU —', '']
  lines.push(`Total registrations: ${fmtNum(s.totals.registered)}`)
  if (attendancePopulated) {
    lines.push(`Total attendees: ${fmtNum(s.totals.attendees)}`)
    lines.push(`Attendance rate: ${pct(s.rates.attendance_rate)}`)
  } else {
    lines.push('Attendance data: not populated yet')
  }
  if (purchasesMapped) {
    lines.push(`Total purchases: ${s.totals.purchases}`)
    lines.push(`Attendee → purchase conversion: ${pct(s.rates.purchase_rate)}`)
    lines.push(`Total revenue: ${fmtPln(s.totals.revenue)}`)
  } else {
    lines.push('Purchases: not mapped yet (Make → Wix → webinar_participants not connected)')
  }
  lines.push('')
  lines.push('Full participant list is in the JSU tab — click "Show participants".')
  lines.push('')
  if (s.totals.purchases === 0 && s.totals.attendees > 0) {
    lines.push('Zero purchases with attendees present — check product mapping in Make (email → wix_order_id).')
  } else if (!purchasesMapped) {
    lines.push('Purchases not mapped yet — connect Make to match Wix orders to webinar participants.')
  } else {
    lines.push(s.diagnosis)
  }
  return lines.join('\n')
}

// ── Conversational briefing builders ─────────────────────────────────────────

export function buildOpsBriefing(
  perf: DailyPerformance | null,
  status: DataStatus,
  metaStats?: MetaStatsToday,
  ads?: MetaAdDaily[]
): string {
  if (status === 'NO_DATA' || !perf) {
    return `${pickPhrase(OPENERS)}\n\nNo data for today yet. Make scenarios may not have run, or the day is still early. Check the automation panel.`
  }

  const orders  = perf.wix_orders
  const revenue = perf.wix_revenue
  const spend   = perf.meta_spend
  const cpa     = perf.real_cpa
  const roas    = perf.real_roas
  const metaPurchases = metaStats?.meta_purchases ?? 0

  const lines: string[] = [pickPhrase(OPENERS), '']

  lines.push(`Today: ${orders} Wix orders, ${fmtPln(revenue)} revenue, ${fmtPln(spend)} Meta ad spend.`)

  if (cpa != null && roas != null) {
    lines.push(`Real CPA: ${fmtPln(cpa)}. Real ROAS: ${fmt(roas, 2, 'x')}.`)
  } else if (cpa != null) {
    lines.push(`Real CPA: ${fmtPln(cpa)}.`)
  }

  if (metaPurchases > 0 && orders !== metaPurchases) {
    const diff = orders - metaPurchases
    if (diff > 0) {
      lines.push(`Meta attributes ${metaPurchases} purchases — ${diff} real Wix orders are unattributed. Tracking is undercounting.`)
    } else {
      lines.push(`Meta attributes ${metaPurchases} purchases but Wix shows only ${orders} real orders. Possible tracking overcount.`)
    }
  }

  if (metaStats?.isStale) {
    lines.push('Note: Meta data looks stale — no ad spend synced for today Warsaw time. Wix numbers are reliable.')
  }

  if (status === 'SALES_WARNING') {
    lines.push('Warning: ad spend is running but Wix shows zero orders. Check the landing page, checkout flow, and pixel.')
  } else if (status === 'META_NOT_LIVE') {
    lines.push('Meta shows no spend today. Campaigns may be paused or budget exhausted.')
  } else if (cpa != null && cpa > 50) {
    lines.push('CPA is above 50 PLN — above the Memory Pack alert threshold. Review creatives and targeting.')
  } else if (status === 'OK') {
    lines.push(pickPhrase(GOOD_VERDICTS))
  }

  if (ads && ads.length > 0) {
    const top   = ads[0]
    const total = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
    const topPct = total > 0 ? ((top.spend / total) * 100).toFixed(0) : '?'
    lines.push(`Top campaign: "${top.campaign_name ?? top.campaign_id}" — ${fmtPln(top.spend)} (${topPct}% of budget).`)
    if (total > 0 && top.spend / total > 0.7) {
      lines.push('Concentration risk: one campaign consuming over 70% of budget.')
    }
  }

  lines.push('')
  lines.push(pickPhrase(NEXT_MOVES))

  return lines.join('\n')
}

export function buildWorkflowInstructions(
  perf: DailyPerformance | null,
  status: DataStatus,
  ads: MetaAdDaily[],
  metaStats: MetaStatsToday
): string {
  const lines: string[] = ['OPERATIONAL WORKFLOW — Lifidi', '']

  // 1. Data freshness
  if (metaStats.isStale && !perf) {
    lines.push('1. DATA ALERT: Neither Wix nor Meta synced for today (Warsaw time).')
    lines.push('   → Check Make automation runs. Are both scenarios active and scheduled?')
  } else if (metaStats.isStale) {
    lines.push('1. DATA ALERT: Wix data OK, but Meta ads not synced today.')
    lines.push('   → Check the Meta ads Make scenario.')
  } else if (!perf && ads.length === 0) {
    lines.push('1. DATA GAP: No Wix or Meta data yet — day may be early or sync failed.')
    lines.push('   → Check automation panel and wait until after 09:00 Warsaw.')
  } else {
    lines.push('1. DATA: Fresh — Wix and Meta synced. Proceed.')
  }
  lines.push('')

  // 2. Revenue check
  if (perf) {
    const { real_cpa: cpa, wix_orders: orders, wix_revenue: revenue, meta_spend: spend } = perf
    if (orders === 0 && spend > 0) {
      lines.push(`2. ALERT: Zero Wix orders despite ${fmtPln(spend)} ad spend.`)
      lines.push('   → Check checkout flow, Wix payment gateway, and landing page.')
    } else if (cpa != null && cpa > 50) {
      lines.push(`2. CPA ALARM: Real CPA is ${fmtPln(cpa)} — above 50 PLN threshold.`)
      lines.push('   → Review campaign detail below and pause the worst performer.')
    } else if (orders > 0) {
      lines.push(`2. REVENUE OK: ${orders} orders, ${fmtPln(revenue)} today.`)
      lines.push('   → Keep current campaigns running. Review creatives weekly.')
    }
  } else {
    lines.push('2. REVENUE: No Wix data yet — cannot assess.')
  }
  lines.push('')

  // 3. Ads check
  if (ads.length > 0) {
    const zeroBurners = ads.filter(a => (a.spend ?? 0) > 10 && (a.purchases ?? 0) === 0)
    const withPurchases = ads.filter(a => (a.purchases ?? 0) > 0)
    const winner = withPurchases.sort((a, b) => (a.spend / a.purchases!) - (b.spend / b.purchases!))[0]

    if (zeroBurners.length > 0) {
      lines.push(`3. BUDGET BURN: ${zeroBurners.length} campaign(s) spending with zero Meta purchases.`)
      lines.push(`   Burning: ${zeroBurners.map(a => `"${a.campaign_name ?? a.campaign_id}" (${fmtPln(a.spend)})`).join(', ')}`)
      lines.push('   → Pause these campaigns immediately and review creatives.')
    } else if (winner) {
      lines.push(`3. CAMPAIGNS: Winner — "${winner.campaign_name ?? winner.campaign_id}" (CPA: ${fmtPln(winner.spend / winner.purchases!)}).`)
      lines.push('   → Consider scaling budget on winner. Review underperformers.')
    } else {
      lines.push('3. CAMPAIGNS: All campaigns running — no purchases attributed yet.')
    }
  } else {
    lines.push('3. CAMPAIGNS: No campaign-level data — check Meta sync.')
  }
  lines.push('')

  // 4. Attribution gap
  if (perf && metaStats.meta_purchases > 0 && perf.wix_orders > 0) {
    const gap = perf.wix_orders - metaStats.meta_purchases
    if (Math.abs(gap) > 2) {
      lines.push(`4. TRACKING GAP: Wix=${perf.wix_orders} orders vs Meta=${metaStats.meta_purchases} attributed.`)
      lines.push(gap > 0
        ? '   → Verify Meta pixel fires on Wix order confirmation page.'
        : '   → Check for duplicate pixel events or cross-device attribution.')
    } else {
      lines.push('4. TRACKING: Attribution consistent. No action needed.')
    }
  } else {
    lines.push('4. TRACKING: Insufficient data — check after orders come in today.')
  }
  lines.push('')

  lines.push('Ask "diagnose ads" for campaign detail or "how was yesterday" for trend context.')
  return lines.join('\n')
}

export function buildMetaVsWix(
  perf: DailyPerformance | null,
  metaStats: MetaStatsToday,
  ads: MetaAdDaily[]
): string {
  // If we have campaign-level ads data, use the detailed diagnosis
  if (ads.length > 0) {
    return buildAdsDiagnosis(perf, metaStats, ads)
  }

  if (!perf) {
    if (metaStats.isStale && metaStats.latestDate) {
      return `${pickPhrase(OPENERS)}\n\nMeta data is stale — latest data is from ${metaStats.latestDate}, not today. Make may not have synced yet.`
    }
    return `${pickPhrase(OPENERS)}\n\nNo data yet — cannot compare Meta and Wix. Check the automation panel.`
  }

  const spend   = perf.meta_spend
  const orders  = perf.wix_orders
  const revenue = perf.wix_revenue
  const metaPurchases = metaStats.meta_purchases
  const roas    = perf.real_roas
  const cpa     = perf.real_cpa

  const lines = [
    pickPhrase(OPENERS), '',
    '— META vs WIX —', '',
    `Meta ad spend: ${fmtPln(spend)}`,
    `Wix real orders: ${orders}`,
    `Wix real revenue: ${fmtPln(revenue)}`,
    `Meta-attributed purchases: ${metaPurchases}`,
    '',
  ]

  if (spend > 0 && orders > 0) {
    if (cpa != null) lines.push(`Real CPA (spend ÷ Wix orders): ${fmtPln(cpa)}`)
    if (roas != null) lines.push(`Real ROAS (Wix revenue ÷ spend): ${fmt(roas, 2, 'x')}`)
    lines.push('')
  }

  if (metaPurchases > 0) {
    const diff = orders - metaPurchases
    if (diff > 0) {
      lines.push(`Discrepancy: ${diff} Wix orders have no Meta attribution. Meta is undercounting conversions.`)
    } else if (diff < 0) {
      lines.push(`Discrepancy: Meta claims ${Math.abs(diff)} more purchases than Wix recorded. Possible view-through inflation or pixel misfire.`)
    } else {
      lines.push('Meta and Wix agree on purchase count. Tracking looks clean.')
    }
  } else if (spend > 0) {
    lines.push('Meta purchases are zero — either the pixel is not firing or attributions have not been processed yet.')
  }

  if (roas != null) {
    if (roas >= 3)      lines.push('\nROAS above 3x. Ads appear profitable at current CPA.')
    else if (roas >= 2) lines.push('\nROAS between 2x and 3x. Marginal — monitor CPA closely.')
    else                lines.push('\nROAS below 2x. Ads may not be covering costs. Review creatives and targeting.')
  }

  return lines.join('\n')
}

// ── Time-aware builders ───────────────────────────────────────────────────────

function dailySummaryBlock(row: DailyPerformance, label: string): string {
  const lines = [
    `${label} (${row.date}):`,
    `  Orders: ${row.wix_orders}  |  Revenue: ${fmtPln(row.wix_revenue)}  |  Spend: ${fmtPln(row.meta_spend)}`,
  ]
  if (row.real_cpa != null)  lines.push(`  CPA: ${fmtPln(row.real_cpa)}  |  ROAS: ${row.real_roas != null ? fmt(row.real_roas, 2, 'x') : '—'}`)
  return lines.join('\n')
}

export function buildYesterdaySummary(trend: DailyPerformance[]): string {
  const yDate = yesterdayWaw()
  const row = trend.find(r => r.date === yDate) ?? trend[1] ?? null

  if (!row) {
    return `${pickPhrase(OPENERS)}\n\nNo data for yesterday. Make may not have synced it yet, or the day is still being processed.`
  }

  const orders  = row.wix_orders ?? 0
  const revenue = row.wix_revenue ?? 0
  const spend   = row.meta_spend ?? 0
  const cpa     = row.real_cpa
  const roas    = row.real_roas

  const lines = [
    pickPhrase(OPENERS), '',
    `— YESTERDAY — ${row.date} —`, '',
    `Orders: ${orders}`,
    `Revenue: ${fmtPln(revenue)}`,
    `Meta spend: ${fmtPln(spend)}`,
  ]

  if (cpa != null)  lines.push(`Real CPA: ${fmtPln(cpa)}`)
  if (roas != null) lines.push(`Real ROAS: ${fmt(roas, 2, 'x')}`)

  if (spend > 0 && orders === 0) {
    lines.push('\nMoney went out, nothing came back. Something broke in the funnel yesterday.')
  } else if (cpa != null && cpa > 50) {
    lines.push(`\nCPA was above 50 PLN — costly acquisition day.`)
  } else if (roas != null && roas >= 3) {
    lines.push(`\nROAS at ${fmt(roas, 2, 'x')} — that was a good day, Lifidi.`)
  } else if (roas != null && roas < 2) {
    lines.push(`\nROAS below 2x yesterday. Ads were not paying for themselves.`)
  } else if (orders > 0) {
    lines.push('\nNumbers came in. Not breaking records, not breaking down.')
  }

  return lines.join('\n')
}

export function buildWeekToDate(trend: DailyPerformance[]): string {
  const weekStart = thisWeekStartWaw()
  const rows = trend.filter(r => r.date >= weekStart).sort((a, b) => a.date < b.date ? -1 : 1)

  if (rows.length === 0) {
    return `${pickPhrase(OPENERS)}\n\nNo data for this week yet. Either today is Monday morning or Make has not synced.`
  }

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend ?? 0), 0)
  const wtdCPA  = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const wtdROAS = totalSpend > 0 ? totalRevenue / totalSpend : null

  const lines = [
    pickPhrase(OPENERS), '',
    `— WEEK SO FAR — (${rows.length} day${rows.length > 1 ? 's' : ''}, since ${weekStart}) —`, '',
    `Total orders: ${totalOrders}`,
    `Total revenue: ${fmtPln(totalRevenue)}`,
    `Total Meta spend: ${fmtPln(totalSpend)}`,
  ]

  if (wtdCPA != null)  lines.push(`Avg CPA: ${fmtPln(wtdCPA)}`)
  if (wtdROAS != null) lines.push(`Avg ROAS: ${fmt(wtdROAS, 2, 'x')}`)

  const best   = rows.reduce((a, b) => (b.wix_revenue ?? 0) > (a.wix_revenue ?? 0) ? b : a)
  const worst  = rows.reduce((a, b) => (b.wix_revenue ?? 0) < (a.wix_revenue ?? 0) ? b : a)
  lines.push('', `Best day: ${best.date} — ${fmtPln(best.wix_revenue)}, ${best.wix_orders} orders.`)
  if (rows.length > 1 && worst.date !== best.date) {
    lines.push(`Weakest day: ${worst.date} — ${fmtPln(worst.wix_revenue)}, ${worst.wix_orders} orders.`)
  }

  if (wtdCPA != null && wtdCPA > 50) {
    lines.push('CPA running above 50 PLN for the week. Creatives need a look.')
  } else if (wtdROAS != null && wtdROAS >= 3) {
    lines.push('ROAS above 3x — strong week so far. Keep the machine running.')
  } else if (wtdROAS != null && wtdROAS < 2) {
    lines.push('ROAS below 2x for the week. Margin is thin — check targeting and creatives.')
  }

  return lines.join('\n')
}

export function buildLastWeekSummary(trend: DailyPerformance[]): string {
  const lastStart = lastWeekStartWaw()
  const lastEnd   = lastWeekEndWaw()
  const rows = trend.filter(r => r.date >= lastStart && r.date <= lastEnd)

  if (rows.length === 0) {
    return `${pickPhrase(OPENERS)}\n\nLast week (${lastStart} to ${lastEnd}) is outside the 7-day history window. Cannot show it without fetching more data.`
  }

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend ?? 0), 0)
  const lwCPA  = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const lwROAS = totalSpend > 0 ? totalRevenue / totalSpend : null

  const lines = [
    pickPhrase(OPENERS), '',
    `— LAST WEEK — (${rows.length} day${rows.length > 1 ? 's' : ''} visible, ${lastStart}–${lastEnd}) —`, '',
    `Total orders: ${totalOrders}`,
    `Total revenue: ${fmtPln(totalRevenue)}`,
    `Total Meta spend: ${fmtPln(totalSpend)}`,
  ]

  if (lwCPA != null)  lines.push(`Avg CPA: ${fmtPln(lwCPA)}`)
  if (lwROAS != null) lines.push(`Avg ROAS: ${fmt(lwROAS, 2, 'x')}`)

  if (rows.length < 7) {
    lines.push(`\n(Only ${rows.length} of 7 last-week days are in the 7-day window. Earlier days are not visible.)`)
  }

  return lines.join('\n')
}

export function buildLast7Days(trend: DailyPerformance[]): string {
  if (trend.length === 0) {
    return `${pickPhrase(OPENERS)}\n\nNo data for the last 7 days.`
  }

  const sorted = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)
  const from   = sorted[0].date
  const to     = sorted[sorted.length - 1].date

  const totalOrders  = sorted.reduce((s, r) => s + (r.wix_orders ?? 0), 0)
  const totalRevenue = sorted.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = sorted.reduce((s, r) => s + (r.meta_spend ?? 0), 0)
  const avgCPA  = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : null
  const dailyAvgRev = totalRevenue / sorted.length

  const lines = [
    pickPhrase(OPENERS), '',
    `— LAST 7 DAYS — (${from} → ${to}) —`, '',
    `Total orders: ${totalOrders}`,
    `Total revenue: ${fmtPln(totalRevenue)}`,
    `Total Meta spend: ${fmtPln(totalSpend)}`,
    `Daily avg revenue: ${fmtPln(dailyAvgRev)}`,
  ]

  if (avgCPA != null)  lines.push(`Avg CPA: ${fmtPln(avgCPA)}`)
  if (avgROAS != null) lines.push(`Avg ROAS: ${fmt(avgROAS, 2, 'x')}`)

  const best  = sorted.reduce((a, b) => (b.wix_revenue ?? 0) > (a.wix_revenue ?? 0) ? b : a)
  const worst = sorted.reduce((a, b) => (b.wix_revenue ?? 0) < (a.wix_revenue ?? 0) ? b : a)
  lines.push('', `Best day: ${best.date} — ${fmtPln(best.wix_revenue)}, ${best.wix_orders} orders.`)
  if (worst.date !== best.date) {
    lines.push(`Weakest day: ${worst.date} — ${fmtPln(worst.wix_revenue)}, ${worst.wix_orders} orders.`)
  }

  return lines.join('\n')
}

export function buildPeriodComparison(
  trend: DailyPerformance[],
  type: 'today-vs-yesterday' | 'this-week-vs-last-week'
): string {
  if (type === 'today-vs-yesterday') {
    const sorted = [...trend].sort((a, b) => b.date < a.date ? -1 : 1) // desc
    const todayRow = sorted[0] ?? null
    const yRow     = sorted[1] ?? null

    if (!todayRow) return `${pickPhrase(OPENERS)}\n\nNot enough data to compare today and yesterday.`

    const lines = [pickPhrase(OPENERS), '', '— TODAY vs YESTERDAY —', '']

    lines.push(dailySummaryBlock(todayRow, 'Today'))
    lines.push('')
    if (yRow) {
      lines.push(dailySummaryBlock(yRow, 'Yesterday'))
      lines.push('')

      const revDelta   = (todayRow.wix_revenue ?? 0) - (yRow.wix_revenue ?? 0)
      const orderDelta = (todayRow.wix_orders  ?? 0) - (yRow.wix_orders  ?? 0)
      const spendDelta = (todayRow.meta_spend  ?? 0) - (yRow.meta_spend  ?? 0)
      const sign = (n: number) => n >= 0 ? '+' : ''

      lines.push('— DELTAS vs YESTERDAY —')
      lines.push(`  Revenue: ${sign(revDelta)}${fmtPln(revDelta)}  |  Orders: ${sign(orderDelta)}${orderDelta}  |  Spend: ${sign(spendDelta)}${fmtPln(spendDelta)}`)

      if (todayRow.real_cpa != null || yRow.real_cpa != null) {
        const cpaPart   = `CPA: ${todayRow.real_cpa != null ? fmtPln(todayRow.real_cpa) : '—'} today vs ${yRow.real_cpa != null ? fmtPln(yRow.real_cpa) : '—'} yesterday`
        const roasPart  = `ROAS: ${todayRow.real_roas != null ? fmt(todayRow.real_roas, 2, 'x') : '—'} today vs ${yRow.real_roas != null ? fmt(yRow.real_roas, 2, 'x') : '—'} yesterday`
        lines.push(`  ${cpaPart}  |  ${roasPart}`)
      }
      lines.push('')

      if (revDelta > 0) {
        lines.push('Verdict: Today is ahead. Keep it up, Lifidi.')
      } else if (revDelta < 0) {
        lines.push('Verdict: Today is behind yesterday. Day not over — push creatives or pause worst campaigns.')
      } else {
        lines.push('Verdict: Identical to yesterday. Very consistent, for better or worse.')
      }
    } else {
      lines.push('No yesterday data in the 7-day window.')
    }

    return lines.join('\n')
  }

  // this-week-vs-last-week
  const weekStart = thisWeekStartWaw()
  const lastStart = lastWeekStartWaw()
  const lastEnd   = lastWeekEndWaw()

  const twRows = trend.filter(r => r.date >= weekStart)
  const lwRows = trend.filter(r => r.date >= lastStart && r.date <= lastEnd)

  const sum = (rows: DailyPerformance[]) => ({
    orders:  rows.reduce((s, r) => s + (r.wix_orders ?? 0), 0),
    revenue: rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0),
    spend:   rows.reduce((s, r) => s + (r.meta_spend ?? 0), 0),
    days:    rows.length,
  })

  const tw = sum(twRows)
  const lw = sum(lwRows)

  const lines = [pickPhrase(OPENERS), '', '— THIS WEEK vs LAST WEEK —', '']

  lines.push(`This week (${tw.days} days, from ${weekStart}):`)
  lines.push(`  Orders: ${tw.orders}  |  Revenue: ${fmtPln(tw.revenue)}  |  Spend: ${fmtPln(tw.spend)}`)
  const twCPA  = tw.spend > 0 && tw.orders > 0 ? tw.spend / tw.orders : null
  const twROAS = tw.spend > 0 ? tw.revenue / tw.spend : null
  if (twCPA)  lines.push(`  CPA: ${fmtPln(twCPA)}`)
  if (twROAS) lines.push(`  ROAS: ${fmt(twROAS, 2, 'x')}`)
  lines.push('')

  if (lw.days > 0) {
    lines.push(`Last week (${lw.days} day${lw.days > 1 ? 's' : ''} visible, from ${lastStart}):`)
    lines.push(`  Orders: ${lw.orders}  |  Revenue: ${fmtPln(lw.revenue)}  |  Spend: ${fmtPln(lw.spend)}`)
    const lwCPA  = lw.spend > 0 && lw.orders > 0 ? lw.spend / lw.orders : null
    const lwROAS = lw.spend > 0 ? lw.revenue / lw.spend : null
    if (lwCPA)  lines.push(`  CPA: ${fmtPln(lwCPA)}`)
    if (lwROAS) lines.push(`  ROAS: ${fmt(lwROAS, 2, 'x')}`)
    lines.push('')

    const revDelta   = tw.revenue - lw.revenue
    const orderDelta = tw.orders - lw.orders
    if (revDelta > 0) {
      lines.push(`This week running ${fmtPln(revDelta)} ahead in revenue vs last week's visible days. ${orderDelta > 0 ? `${orderDelta} more orders.` : ''}`)
    } else if (revDelta < 0) {
      lines.push(`This week is ${fmtPln(Math.abs(revDelta))} behind last week's visible days. Worth investigating.`)
    } else {
      lines.push('Revenue tracking identical to last week. Very consistent.')
    }

    if (lw.days < 7) {
      lines.push(`\n(Only ${lw.days} last-week days are in the 7-day window — comparison is partial.)`)
    }
  } else {
    lines.push('Last week is outside the 7-day history window — cannot compare.')
  }

  return lines.join('\n')
}

export function buildAdsDiagnosis(
  perf: DailyPerformance | null,
  metaStats: MetaStatsToday,
  ads: MetaAdDaily[]
): string {
  const opener = pickPhrase(OPENERS)

  // ── No campaign rows at all ────────────────────────────────────────────────
  if (ads.length === 0) {
    if (metaStats.isStale && metaStats.latestDate) {
      return [
        opener, '',
        `Meta data is stale — latest campaign data is from ${metaStats.latestDate}, not today.`,
        'Make may not have synced yet. Check the automation panel.',
        '',
        perf ? `Aggregated: Wix orders ${perf.wix_orders}, revenue ${fmtPln(perf.wix_revenue)}, Meta spend ${fmtPln(perf.meta_spend)}.` : '',
      ].filter(l => l !== '').join('\n')
    }
    if (!perf || (perf.meta_spend === 0 && perf.wix_orders === 0)) {
      return `${opener}\n\nNo Meta campaign data for today yet. Either Make has not synced or the day is still early. Check the automation panel.`
    }
    // perf has data but no campaign rows — aggregated only
    return buildOpsBriefing(perf, 'OK', metaStats, ads)
  }

  // ── Campaign-level data available ─────────────────────────────────────────
  const totalSpend     = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
  const totalPurchases = ads.reduce((s, a) => s + (a.purchases ?? 0), 0)

  const adsDate = ads[0]?.date ?? ''
  const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const isStaleAds = adsDate !== '' && adsDate < today

  const lines: string[] = [opener, '', `— ADS DIAGNOSIS — ${isStaleAds ? adsDate + ' (latest available)' : 'TODAY'} —`, '']

  if (isStaleAds) {
    lines.push(`Note: Today's Meta data has not arrived yet. Showing campaign data from ${adsDate}.`)
    lines.push('')
  }

  // Per-campaign breakdown
  lines.push('Campaign breakdown:')
  for (const ad of ads) {
    const name     = ad.campaign_name ?? ad.campaign_id ?? '?'
    const spendPct = totalSpend > 0 ? ((ad.spend / totalSpend) * 100).toFixed(0) : '?'
    const metaCpa  = ad.spend > 0 && ad.purchases > 0 ? ad.spend / ad.purchases : null
    const purchStr = ad.purchases > 0
      ? `${ad.purchases} purchases  CPA: ${fmtPln(metaCpa)}`
      : '0 purchases'
    // Compute CTR and CPC if not stored
    const ctr = ad.ctr ?? (ad.link_clicks > 0 && ad.impressions > 0 ? (ad.link_clicks / ad.impressions) * 100 : null)
    const cpc = ad.cpc ?? (ad.link_clicks > 0 ? ad.spend / ad.link_clicks : null)
    lines.push(`  "${name}"`)
    lines.push(`    spend: ${fmtPln(ad.spend)} (${spendPct}%)  ${purchStr}  clicks: ${ad.link_clicks ?? 0}${ctr != null ? `  CTR: ${ctr.toFixed(1)}%` : ''}${cpc != null ? `  CPC: ${fmtPln(cpc)}` : ''}`)
  }
  lines.push(`  Total: ${fmtPln(totalSpend)} spend  ${totalPurchases} purchases`)
  lines.push('')

  // ── Winner / Watch ────────────────────────────────────────────────────────
  const withPurchases = ads.filter(a => (a.purchases ?? 0) > 0 && (a.spend ?? 0) > 0)
  const zeroBurners   = ads.filter(a => (a.spend ?? 0) > 10 && (a.purchases ?? 0) === 0)

  if (withPurchases.length > 0) {
    const best = withPurchases.reduce((prev, curr) => {
      return (curr.spend / curr.purchases) < (prev.spend / prev.purchases) ? curr : prev
    })
    const bestCpa = best.spend / best.purchases
    lines.push(`Winner: "${best.campaign_name ?? best.campaign_id}" — Meta CPA ${fmtPln(bestCpa)}, ${best.purchases} purchases.`)
  }

  if (zeroBurners.length > 0) {
    lines.push(`Burning budget: ${zeroBurners.map(a => `"${a.campaign_name ?? a.campaign_id}" (${fmtPln(a.spend)}, 0 Meta purchases)`).join(' | ')}.`)
  }

  // Worst (highest CPA)
  if (withPurchases.length > 1) {
    const worst = withPurchases.reduce((prev, curr) => {
      return (curr.spend / curr.purchases) > (prev.spend / prev.purchases) ? curr : prev
    })
    const worstCpa = worst.spend / worst.purchases
    lines.push(`Most expensive: "${worst.campaign_name ?? worst.campaign_id}" — Meta CPA ${fmtPln(worstCpa)}.`)
  }

  // Concentration
  if (totalSpend > 0 && ads.length > 1) {
    const top    = ads[0]
    const topPct = (top.spend / totalSpend) * 100
    if (topPct > 70) {
      lines.push(`Concentration risk: "${top.campaign_name ?? top.campaign_id}" consuming ${topPct.toFixed(0)}% of total budget.`)
    }
  }

  // Zero-attribution day note
  if (totalPurchases === 0 && totalSpend > 0) {
    lines.push('Zero-attribution day: Meta spend is tracked, but Meta purchase events are zero.')
    lines.push('This is NOT missing data — Meta spend is syncing correctly.')
    lines.push('Causes: attribution delay (~24h), Meta pixel not firing on Wix order confirmation, or purchase value mapping issue.')
    if (perf && perf.wix_orders > 0) {
      lines.push(`Wix real orders: ${perf.wix_orders} — cross-reference Meta spend against this, not Meta purchases.`)
    }
  }

  lines.push('')

  // ── Real Wix context ──────────────────────────────────────────────────────
  if (perf) {
    const wixOrders  = perf.wix_orders ?? 0
    const wixRevenue = perf.wix_revenue ?? 0
    const realCpa    = perf.real_cpa
    const realRoas   = perf.real_roas

    lines.push('Real business context (Wix):')
    lines.push(`  Wix orders: ${wixOrders}  |  Revenue: ${fmtPln(wixRevenue)}`)
    if (realCpa  != null) lines.push(`  Real CPA: ${fmtPln(realCpa)}  |  Real ROAS: ${realRoas != null ? fmt(realRoas, 2, 'x') : '—'}`)

    if (totalPurchases === 0 && wixOrders > 0) {
      lines.push(`  Meta shows 0 purchases, Wix shows ${wixOrders} real orders. Pixel is not firing — diagnose the Meta pixel setup.`)
    } else if (totalPurchases > 0 && wixOrders !== totalPurchases) {
      const gap = wixOrders - totalPurchases
      if (gap > 0) {
        lines.push(`  Attribution gap: Meta reports ${totalPurchases} purchases, Wix shows ${wixOrders}. ${gap} orders are untracked. Judge profit by real CPA, not Meta CPA.`)
      } else {
        lines.push(`  Attribution overcount: Meta claims ${totalPurchases} purchases but Wix shows only ${wixOrders} orders. Possible view-through or duplicate events.`)
      }
    }

    if (realCpa != null && realCpa > 50) {
      lines.push('  Real CPA above 50 PLN alert threshold — review creatives and targeting.')
    } else if (realRoas != null && realRoas >= 3) {
      lines.push('  Real ROAS above 3x — ads are covering costs. Keep pushing.')
    } else if (realRoas != null && realRoas < 2) {
      lines.push('  Real ROAS below 2x — ads may not be covering costs. Check CPA ceiling.')
    }
  }

  lines.push('')
  lines.push(pickPhrase(NEXT_MOVES))

  return lines.join('\n')
}

// ── Spoken text builders ──────────────────────────────────────────────────────

export function buildYesterdaySpoken(trend: DailyPerformance[]): string {
  const yDate = yesterdayWaw()
  const row = trend.find(r => r.date === yDate) ?? trend[1] ?? null
  if (!row) return 'No data for yesterday yet.'

  const orders  = row.wix_orders  ?? 0
  const revenue = row.wix_revenue ?? 0
  const spend   = row.meta_spend  ?? 0
  const cpa     = row.real_cpa
  const roas    = row.real_roas

  const parts: string[] = [
    `Yesterday on ${row.date}: ${orders} Wix orders, ${revenue.toFixed(0)} Polish zloty revenue, ${spend.toFixed(0)} zloty Meta spend.`,
  ]
  if (cpa != null) parts.push(`Real C P A was ${cpa.toFixed(0)} zloty.`)
  if (spend > 0 && orders === 0) {
    parts.push('Money went out and nothing came back. Something broke in the funnel yesterday.')
  } else if (cpa != null && cpa > 50) {
    parts.push(`C P A above 50 zloty — costly day. Check which campaign drove the spend.`)
  } else if (roas != null && roas >= 3) {
    parts.push(`R O A S at ${roas.toFixed(2)} — that was a good day, Lifidi.`)
  } else if (roas != null && roas < 2) {
    parts.push(`R O A S below 2 — ads were not paying for themselves. Review creatives.`)
  } else if (orders > 0) {
    parts.push('Numbers came in. Not a record, not a disaster.')
  }
  return parts.join(' ')
}

export function buildOpsBriefingSpoken(
  perf: DailyPerformance | null,
  status: DataStatus,
  metaStats?: MetaStatsToday,
  ads?: MetaAdDaily[]
): string {
  if (status === 'NO_DATA' || !perf) {
    return 'No data for today yet. Make scenarios may not have run, or the day is still early.'
  }
  const orders  = perf.wix_orders
  const revenue = perf.wix_revenue
  const spend   = perf.meta_spend
  const cpa     = perf.real_cpa
  const roas    = perf.real_roas

  const parts: string[] = [
    `Lifidi, today: ${orders} Wix orders, ${revenue.toFixed(0)} Polish zloty revenue, ${spend.toFixed(0)} zloty Meta spend.`,
  ]
  if (cpa != null) parts.push(`Real C P A is ${cpa.toFixed(0)} zloty.`)
  if (status === 'SALES_WARNING') {
    parts.push('Warning: ad spend is running but Wix shows zero orders. Check the landing page, checkout flow, and pixel.')
  } else if (status === 'META_NOT_LIVE') {
    parts.push('Meta shows no spend today. Campaigns may be paused or budget exhausted.')
  } else if (cpa != null && cpa > 50) {
    parts.push('C P A above 50 zloty — above the alert threshold. Review creatives and targeting.')
  } else if (roas != null && roas >= 3) {
    parts.push(`R O A S at ${roas.toFixed(2)} — ads are covering costs. Keep pushing.`)
  } else if (roas != null && roas < 2) {
    parts.push(`R O A S at ${roas.toFixed(2)} — margin is thin. Watch creatives.`)
  }
  if (ads && ads.length > 0) {
    const top    = ads[0]
    const total  = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
    const topPct = total > 0 ? Math.round((top.spend / total) * 100) : 0
    parts.push(`Top campaign is "${top.campaign_name ?? top.campaign_id}", taking ${topPct}% of budget.`)
  }
  if (metaStats?.isStale) {
    parts.push('Note: Meta data looks stale. Wix numbers are reliable, ad data may be from an earlier day.')
  }
  return parts.join(' ')
}

export function buildAdsDiagnosisSpoken(
  perf: DailyPerformance | null,
  _metaStats: MetaStatsToday,
  ads: MetaAdDaily[]
): string {
  if (ads.length === 0) return 'No campaign data for today yet. Check the automation panel.'

  const adsDate    = ads[0]?.date ?? ''
  const today      = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const isStaleAds = adsDate !== '' && adsDate < today

  const totalSpend    = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
  const zeroBurners   = ads.filter(a => (a.spend ?? 0) > 10 && (a.purchases ?? 0) === 0)
  const withPurchases = ads.filter(a => (a.purchases ?? 0) > 0)
  const parts: string[] = []

  if (isStaleAds) {
    parts.push(`Heads up, Lifidi — today's Meta data is not in yet. I am using campaign data from ${adsDate}.`)
  }

  if (withPurchases.length > 0) {
    const best    = withPurchases.reduce((a, b) => (a.spend / a.purchases!) < (b.spend / b.purchases!) ? a : b)
    const bestCpa = best.spend / best.purchases!
    parts.push(`Best performer: "${best.campaign_name ?? best.campaign_id}" — ${best.purchases} purchases at ${bestCpa.toFixed(0)} zloty C P A.`)
    if (withPurchases.length > 1) {
      const worst    = withPurchases.reduce((a, b) => (a.spend / a.purchases!) > (b.spend / b.purchases!) ? a : b)
      const worstCpa = worst.spend / worst.purchases!
      if (worst !== best) parts.push(`Worst C P A: "${worst.campaign_name ?? worst.campaign_id}" at ${worstCpa.toFixed(0)} zloty.`)
    }
  }
  if (zeroBurners.length > 0) {
    const names = zeroBurners.map(a => `"${a.campaign_name ?? a.campaign_id}" spending ${a.spend.toFixed(0)} zloty`).join(' and ')
    parts.push(`${names} ${zeroBurners.length === 1 ? 'is' : 'are'} burning budget with zero Meta purchases. Consider pausing.`)
  }
  if (withPurchases.length === 0) {
    // Zero-attribution day — Meta spending but no purchases reported
    parts.push(`Zero-attribution day, Lifidi. Meta spent ${totalSpend.toFixed(0)} zloty but reports zero purchases. This is not missing data — it is attribution delay or pixel mapping.`)
    if (perf?.wix_orders && perf.wix_orders > 0) {
      parts.push(`Wix shows ${perf.wix_orders} real orders — the business IS selling. Judge by real C P A, not Meta C P A.`)
    }
    const topSpender = ads[0]
    if (topSpender) {
      parts.push(`Biggest spender: "${topSpender.campaign_name ?? topSpender.campaign_id}" at ${topSpender.spend.toFixed(0)} zloty.`)
    }
    parts.push('Campaign breakdown is on screen.')
    return parts.join(' ')
  }
  if (perf) {
    const cpa = perf.real_cpa
    if (cpa != null && cpa > 50) parts.push(`Real C P A from Wix is ${cpa.toFixed(0)} zloty — above the alert threshold.`)
    else if (perf.real_roas != null && perf.real_roas >= 3) parts.push(`Real R O A S is ${perf.real_roas.toFixed(2)} — ads are profitable by Wix data.`)
  }
  parts.push('Campaign breakdown is on screen.')
  return parts.join(' ')
}

export function buildPeriodComparisonSpoken(
  trend: DailyPerformance[],
  type: 'today-vs-yesterday' | 'this-week-vs-last-week'
): string {
  if (type === 'today-vs-yesterday') {
    const sorted    = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)
    const today     = sorted[sorted.length - 1] ?? null
    const yesterday = sorted[sorted.length - 2] ?? null
    if (!today) return 'Not enough data for comparison.'

    const tRev   = today.wix_revenue ?? 0
    const tOrd   = today.wix_orders  ?? 0
    const tSpend = today.meta_spend  ?? 0
    const tCPA   = today.real_cpa
    const tROAS  = today.real_roas

    const parts: string[] = []

    if (yesterday) {
      const yRev   = yesterday.wix_revenue ?? 0
      const yOrd   = yesterday.wix_orders  ?? 0
      const ySpend = yesterday.meta_spend  ?? 0
      const yCPA   = yesterday.real_cpa
      const revDelta   = tRev - yRev
      const ordDelta   = tOrd - yOrd
      const spendDelta = tSpend - ySpend

      // Opening verdict
      if (revDelta > 0) {
        parts.push(`Today is ahead of yesterday, Lifidi. Revenue up from ${yRev.toFixed(0)} to ${tRev.toFixed(0)} Polish zloty.`)
      } else if (revDelta < 0) {
        parts.push(`Today is weaker than yesterday, Lifidi. Revenue dropped from ${yRev.toFixed(0)} to ${tRev.toFixed(0)} Polish zloty.`)
      } else {
        parts.push(`Today matches yesterday exactly, Lifidi. Revenue at ${tRev.toFixed(0)} Polish zloty.`)
      }

      // Orders
      if (ordDelta > 0)       parts.push(`Orders up from ${yOrd} to ${tOrd}.`)
      else if (ordDelta < 0)  parts.push(`Orders down from ${yOrd} to ${tOrd}.`)
      else                    parts.push(`Orders unchanged at ${tOrd}.`)

      // Spend comparison
      if (Math.abs(spendDelta) > 5) {
        parts.push(`Ad spend is ${spendDelta > 0 ? 'higher' : 'lower'} today: ${tSpend.toFixed(0)} vs ${ySpend.toFixed(0)} zloty yesterday.`)
      }

      // CPA
      if (tCPA != null) {
        if (yCPA != null) {
          const cpaDelta = tCPA - yCPA
          if (Math.abs(cpaDelta) > 3) {
            parts.push(`Real C P A is ${tCPA.toFixed(0)} zloty${cpaDelta > 0 ? ' — worse' : ' — better'} than ${yCPA.toFixed(0)} yesterday.`)
          } else {
            parts.push(`Real C P A is ${tCPA.toFixed(0)} zloty, similar to yesterday.`)
          }
        } else {
          parts.push(`Real C P A is ${tCPA.toFixed(0)} zloty today.`)
        }
      }

      // ROAS verdict
      if (tROAS != null) {
        if (tROAS < 1)       parts.push(`Real R O A S is below one at ${tROAS.toFixed(2)} — ads losing money today. Campaign-level review needed.`)
        else if (tROAS < 2)  parts.push(`Real R O A S at ${tROAS.toFixed(2)} — marginal. Watch creatives.`)
        else if (tROAS >= 3) parts.push(`Real R O A S at ${tROAS.toFixed(2)} — ads are paying off well.`)
        else                 parts.push(`Real R O A S at ${tROAS.toFixed(2)}.`)
      }
    } else {
      parts.push(`Today: ${tOrd} orders, ${tRev.toFixed(0)} Polish zloty. No yesterday data available.`)
      if (tCPA != null) parts.push(`Real C P A is ${tCPA.toFixed(0)} zloty.`)
    }

    parts.push('Comparison chart is on screen.')
    return parts.join(' ')
  }
  const weekStart = thisWeekStartWaw()
  const lastStart = lastWeekStartWaw()
  const lastEnd   = lastWeekEndWaw()
  const twRows    = trend.filter(r => r.date >= weekStart)
  const lwRows    = trend.filter(r => r.date >= lastStart && r.date <= lastEnd)
  const tw = { orders: twRows.reduce((s, r) => s + (r.wix_orders ?? 0), 0), revenue: twRows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0) }
  const lw = { orders: lwRows.reduce((s, r) => s + (r.wix_orders ?? 0), 0), revenue: lwRows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0) }
  const parts: string[] = [`This week so far: ${tw.orders} orders, ${tw.revenue.toFixed(0)} Polish zloty.`]
  if (lwRows.length > 0) {
    parts.push(`Comparable last week: ${lw.orders} orders, ${lw.revenue.toFixed(0)} zloty.`)
    const delta = tw.revenue - lw.revenue
    if (delta > 0)      parts.push(`This week is ${delta.toFixed(0)} zloty ahead. Good trajectory.`)
    else if (delta < 0) parts.push(`This week is ${Math.abs(delta).toFixed(0)} zloty behind. Check what changed.`)
  }
  parts.push('Week comparison chart is on screen.')
  return parts.join(' ')
}

export function buildWeekToDateSpoken(trend: DailyPerformance[]): string {
  const weekStart = thisWeekStartWaw()
  const rows      = trend.filter(r => r.date >= weekStart).sort((a, b) => a.date < b.date ? -1 : 1)
  if (rows.length === 0) return 'No data for this week yet.'

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const wtdCPA  = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const wtdROAS = totalSpend > 0 ? totalRevenue / totalSpend : null
  const best  = rows.reduce((a, b) => (b.wix_revenue ?? 0) > (a.wix_revenue ?? 0) ? b : a)
  const worst = rows.reduce((a, b) => (b.wix_revenue ?? 0) < (a.wix_revenue ?? 0) ? b : a)

  const parts: string[] = [
    `This week so far, ${rows.length} day${rows.length > 1 ? 's' : ''}: ${totalOrders} orders, ${totalRevenue.toFixed(0)} Polish zloty revenue, ${totalSpend.toFixed(0)} zloty Meta spend.`,
  ]
  if (wtdCPA != null) parts.push(`Average C P A is ${wtdCPA.toFixed(0)} zloty.`)
  if (wtdROAS != null) parts.push(`Average R O A S is ${wtdROAS.toFixed(2)}.`)
  parts.push(`Best day was ${best.date} with ${(best.wix_revenue ?? 0).toFixed(0)} zloty and ${best.wix_orders} orders.`)
  if (rows.length > 1 && worst.date !== best.date) {
    parts.push(`Weakest day was ${worst.date} with ${(worst.wix_revenue ?? 0).toFixed(0)} zloty and ${worst.wix_orders} orders.`)
  }
  if (wtdCPA != null && wtdCPA > 50)       parts.push('C P A running above 50 zloty for the week. Creatives need attention.')
  else if (wtdROAS != null && wtdROAS >= 3) parts.push('R O A S above 3 — strong week. Keep the machine running.')
  else if (wtdROAS != null && wtdROAS < 2)  parts.push('R O A S below 2 for the week. Margin is thin.')
  parts.push('Week chart is on screen.')
  return parts.join(' ')
}

export function buildJsuWebinarSpoken(s: JsuFunnelSummary | null, queryHint = ''): string {
  if (!s || s.bottleneck === 'NO_DATA') return 'No webinar data available yet. Connect the ClickMeeting Make scenario.'

  const partCount           = s._debug?.participantsCount ?? 0
  const uniqueEmails        = s._debug?.uniqueEmails       ?? partCount
  const attendancePopulated = (s._debug?.attendanceStatus === 'populated') || s.totals.attendees > 0
  const purchasesMapped     = (s._debug?.purchaseMappingStatus === 'mapped') || s.totals.purchases > 0

  // Detect product from sessions or query
  const productFromSessions = detectProductFromSessions(s)
  const productFromQ        = queryHint ? productFromQuery(queryHint) : 'ALL'
  const product: ProductTag = (productFromQ !== 'ALL' ? productFromQ : productFromSessions) ?? 'JSU'
  const productLabel = product === 'JZK' ? 'Językozak AI language webinar' : 'JSU memory webinar'
  const sessionsLabel = s.sessions.length === 1 ? '1 session' : `${s.sessions.length} sessions`

  if (partCount > 0 && !s.hasClickMeetingData) {
    return `Lifidi, ClickMeeting data is available for the ${productLabel}. ` +
      `I see ${sessionsLabel} and ${partCount} participant rows (${uniqueEmails} unique contacts) in the raw tables. ` +
      'Attendance is not populated yet, so show-up rate cannot be calculated. ' +
      'Purchases are not mapped yet.'
  }

  if (s.bottleneck === 'NO_SOURCES') {
    if (partCount > 0) {
      return `Lifidi, ClickMeeting data is available for the ${productLabel}. ` +
        `I found ${partCount} participant row${partCount > 1 ? 's' : ''} with ${uniqueEmails} unique contact${uniqueEmails > 1 ? 's' : ''}. ` +
        'Attendance data is not populated yet, so show-up rate cannot be calculated. ' +
        'Purchases are not mapped yet.'
    }
    return 'No email or ClickMeeting data yet. Connect the Make scenarios to enable full diagnosis.'
  }

  const parts: string[] = [`Lifidi, here is the ${productLabel} report.`]
  if (s.hasClickMeetingData) {
    parts.push(`${s.totals.registered} registered across ${sessionsLabel}.`)
    if (attendancePopulated) {
      parts.push(`${s.totals.attendees} attended.`)
      if (s.rates.attendance_rate != null) parts.push(`Show-up rate is ${pct(s.rates.attendance_rate)}.`)
    } else {
      parts.push('Attendance data is not populated yet.')
    }
    if (purchasesMapped) {
      parts.push(`${s.totals.purchases} purchases.`)
      if (s.rates.purchase_rate != null) parts.push(`Conversion to purchase is ${pct(s.rates.purchase_rate)}.`)
    } else {
      parts.push('Purchases are not mapped yet.')
    }
  } else {
    parts.push('ClickMeeting registration data is not populated yet.')
  }
  if (s.hasEmailData) {
    parts.push(`Email: ${s.totals.email_sent} sent, ${pct(s.rates.delivery_rate)} delivered, ${pct(s.rates.open_rate)} open rate.`)
  } else {
    parts.push('No email campaign data connected yet.')
  }
  const diagFirst = s.diagnosis.split('.')[0]
  if (diagFirst) parts.push(`${diagFirst}.`)
  if (s.hasClickMeetingData) parts.push('Funnel chart is on screen.')
  return parts.join(' ')
}

/** Detect the dominant product tag from the loaded sessions. */
function detectProductFromSessions(s: JsuFunnelSummary): ProductTag {
  const counts: Record<ProductTag, number> = { JSU: 0, JZK: 0, OTHER: 0 }
  for (const sess of s.sessions) {
    const p = normalizeProduct({ product_tag: sess.product_tag, session_name: sess.session_name })
    counts[p.canonicalTag]++
  }
  if (counts.JZK > counts.JSU) return 'JZK'
  if (counts.JSU > 0) return 'JSU'
  return 'OTHER'
}

// suppress unused import warning — productFromQuery used in buildJsuWebinarSpoken
const _ensureProductFromQueryImport = productFromQuery

// ── Chart spec builders ───────────────────────────────────────────────────────

export function buildTodayVsYesterdayChart(trend: DailyPerformance[]): InsightChartSpec | undefined {
  const sorted = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)
  if (sorted.length < 2) return undefined
  const today     = sorted[sorted.length - 1]
  const yesterday = sorted[sorted.length - 2]
  return {
    type:   'bar',
    title:  'Today vs Yesterday',
    xKey:   'day',
    data:   [
      { day: 'Yesterday', revenue: Math.round(yesterday.wix_revenue ?? 0), spend: Math.round(yesterday.meta_spend ?? 0), orders: yesterday.wix_orders ?? 0 },
      { day: 'Today',     revenue: Math.round(today.wix_revenue     ?? 0), spend: Math.round(today.meta_spend     ?? 0), orders: today.wix_orders     ?? 0 },
    ],
    series: [
      { key: 'revenue', label: 'Revenue', color: 'var(--gold)' },
      { key: 'spend',   label: 'Spend',   color: 'var(--teal)' },
    ],
  }
}

export function buildWeekChart(trend: DailyPerformance[]): InsightChartSpec | undefined {
  const weekStart = thisWeekStartWaw()
  const rows      = trend.filter(r => r.date >= weekStart).sort((a, b) => a.date < b.date ? -1 : 1)
  if (rows.length === 0) return undefined
  return {
    type:   'line',
    title:  'This Week',
    xKey:   'date',
    data:   rows.map(r => ({
      date:    new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
      revenue: Math.round(r.wix_revenue ?? 0),
      spend:   Math.round(r.meta_spend  ?? 0),
      orders:  r.wix_orders ?? 0,
    })),
    series: [
      { key: 'revenue', label: 'Revenue', color: 'var(--gold)' },
      { key: 'spend',   label: 'Spend',   color: 'var(--teal)' },
    ],
  }
}

export function buildLast7Chart(trend: DailyPerformance[]): InsightChartSpec | undefined {
  if (trend.length === 0) return undefined
  const sorted = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)
  return {
    type:   'line',
    title:  'Last 7 Days',
    xKey:   'date',
    data:   sorted.map(r => ({
      date:    new Date(r.date + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
      revenue: Math.round(r.wix_revenue ?? 0),
      spend:   Math.round(r.meta_spend  ?? 0),
      orders:  r.wix_orders ?? 0,
    })),
    series: [
      { key: 'revenue', label: 'Revenue', color: 'var(--gold)' },
      { key: 'spend',   label: 'Spend',   color: 'var(--teal)' },
    ],
  }
}

export function buildCampaignChart(ads: MetaAdDaily[]): InsightChartSpec | undefined {
  if (ads.length === 0) return undefined
  return {
    type:   'funnel',
    title:  'Campaigns Today',
    xKey:   'name',
    data:   ads.map(a => ({
      name:      (a.campaign_name ?? a.campaign_id ?? '?').slice(0, 22),
      spend:     Math.round(a.spend ?? 0),
      cpa:       a.purchases > 0 ? Math.round(a.spend / a.purchases) : null,
      purchases: a.purchases ?? 0,
    })),
    series: [{ key: 'spend', label: 'Spend (PLN)', color: 'var(--teal)' }],
  }
}

export function buildWebinarFunnelChart(s: JsuFunnelSummary | null): InsightChartSpec | undefined {
  if (!s || !s.hasClickMeetingData) return undefined
  const attendancePopulated = (s._debug?.attendanceStatus === 'populated') || s.totals.attendees > 0
  const purchasesMapped     = (s._debug?.purchaseMappingStatus === 'mapped') || s.totals.purchases > 0
  const data = [
    { stage: 'Registered', count: s.totals.registered },
    ...(attendancePopulated ? [{ stage: 'Attended', count: s.totals.attendees }] : []),
    ...(purchasesMapped     ? [{ stage: 'Purchased', count: s.totals.purchases }] : []),
  ].filter(d => d.count > 0)
  if (data.length === 0) return undefined
  return {
    type:   'funnel',
    title:  'Webinar Funnel — JSU',
    xKey:   'stage',
    data,
    series: [{ key: 'count', label: 'Count', color: 'var(--gold)' }],
  }
}
