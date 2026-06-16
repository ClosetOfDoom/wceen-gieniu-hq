import type { DailyPerformance, DataStatus, MetaAdDaily, MetaStatsToday } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { pct } from '../services/webinarFunnel'
import {
  pickPhrase,
  OPENERS, GOOD_VERDICTS, HIGH_CPA_VERDICTS, SALES_WARNING_VERDICTS,
  NO_DATA_VERDICTS, NEXT_MOVES, META_NOT_LIVE_NOTES,
  JSU_OPENERS, JSU_BOTTLENECK_CLOSES, JSU_OK_CLOSES,
} from './personality'

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

// ── Dashboard command types ───────────────────────────────────────────────────

export type CommandKey =
  | 'revenue dzisiaj'
  | 'raport operacyjny'
  | 'pipeline'
  | 'progi CPA'
  | 'progi CPA językowy'
  | 'red flagi'
  | 'kreatywy'
  | 'retargeting'
  | 'rytm maili'
  | 'co tydzień'

export const COMMANDS: { key: CommandKey; label: string }[] = [
  { key: 'revenue dzisiaj',    label: 'Revenue Today' },
  { key: 'raport operacyjny',  label: 'Ops Report' },
  { key: 'pipeline',           label: 'Pipeline' },
  { key: 'progi CPA',          label: 'CPA Thresholds' },
  { key: 'progi CPA językowy', label: 'CPA Thresholds — Lang' },
  { key: 'red flagi',          label: 'Red Flags' },
  { key: 'kreatywy',           label: 'Creatives' },
  { key: 'retargeting',        label: 'Retargeting' },
  { key: 'rytm maili',         label: 'Mailing Rhythm' },
  { key: 'co tydzień',         label: 'Weekly Checklist' },
]

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
  const verdict = ar !== null && ar < 0.60
    ? `Show-up rate is ${pct(ar)} — below 60%. Check the reminder sequence: email 24h + 1h before. Thursday 18:00 is a solid slot, but reminders can lift attendance.`
    : `Show-up rate is ${pct(ar)} — OK, or not enough historical data to compare.`

  const lines = [opener, '', '— JSU ATTENDANCE RATE —', '']
  for (const sess of s.sessions.slice(0, 5)) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
    lines.push(`  ${date}  ${sess.attendee_count}/${sess.registered_count}  (${sess.attendance_rate_pct ?? '—'}%)`)
  }
  lines.push('', verdict)
  return lines.join('\n')
}

export function buildWhoAttendedAndBought(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasClickMeetingData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNo ClickMeeting data.\nConnect Make → ClickMeeting → webinar_participants in Supabase.`
  }
  const opener = pickPhrase(JSU_OPENERS)
  return [
    opener, '',
    '— WHO ATTENDED AND BOUGHT — JSU —', '',
    `Total attendees (all sessions): ${fmtNum(s.totals.attendees)}`,
    `Total purchases: ${s.totals.purchases}`,
    `Attendee → purchase conversion: ${pct(s.rates.purchase_rate)}`,
    `Total revenue: ${fmtPln(s.totals.revenue)}`,
    '',
    'Full participant list is in the JSU tab — click "Show participants".',
    '',
    s.totals.purchases === 0 && s.totals.attendees > 0
      ? 'Zero purchases with attendees present — check product mapping in Make (email → wix_order_id).'
      : s.diagnosis,
  ].join('\n')
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

export function buildMetaVsWix(
  perf: DailyPerformance | null,
  metaStats: MetaStatsToday,
  ads: MetaAdDaily[]
): string {
  if (!perf) {
    return `${pickPhrase(OPENERS)}\n\nNo data yet — cannot compare Meta and Wix.`
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
  }

  if (metaStats.isStale) {
    lines.push('Meta data is stale — treat ad spend numbers with caution.')
  }

  if (roas != null) {
    if (roas >= 3)      lines.push('\nROAS above 3x. Ads appear profitable at current CPA.')
    else if (roas >= 2) lines.push('\nROAS between 2x and 3x. Marginal — monitor CPA closely.')
    else                lines.push('\nROAS below 2x. Ads may not be covering costs. Review creatives and targeting.')
  }

  if (ads.length > 0) {
    const top = ads[0]
    lines.push(`\nTop campaign: "${top.campaign_name ?? top.campaign_id}" — ${fmtPln(top.spend)} spend, ${top.link_clicks ?? 0} clicks.`)
  }

  return lines.join('\n')
}
