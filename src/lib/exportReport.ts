// exportReport — the ONE place that turns the Command Center's in-memory state
// into the Markdown report the COPY button puts on the clipboard.
//
// It runs no queries. Every number it prints is handed in from the exact same
// variables the KPI cards render from, so a figure in the report that disagrees
// with the figure on screen is a bug in this file, never a different data path.
//
// Where a number does not exist, the report says so by name. It never fills a
// gap with a zero, an average or an estimate: an empty section is worth more
// than a guessed one, because the whole point of the export is to hand another
// analyst something they can trust without re-deriving it.

import type { DailyPerformance, MetaAdDaily } from '../services/data'
import type { ProfitData } from './profitData'
import type { GoalResult } from './goalProgress'
import type { TimeRange } from './timeRange'
import { RANGE_LABELS } from './timeRange'
import { classifyCampaignScope } from './campaignDiagnosis'
import { fmtPln, fmtNum, fmtRoas } from '../utils/format'

export interface ReportGoals {
  pp: GoalResult
  revenue: GoalResult
  cpa: GoalResult
  roas: GoalResult
  /** PP orders counted in the range, or null when profit-data is unavailable. */
  ppOrders: number | null
  /** The paced PP target the bar prints. */
  ppTarget: number
  /** Revenue target for the range, prorated the same way the bar prorates it. */
  revenueTarget: number
}

export interface ReportInput {
  range: TimeRange
  from: string
  to: string
  /** Human sublabel already resolved by rangeSubLabel(). */
  rangeSub: string
  buildHash: string
  /** ISO timestamp. Passed in rather than read from the clock, so tests are fixed. */
  generatedAt: string

  /** The aggregated row the KPI cards read (displayPerf). */
  perf: DailyPerformance | null
  /** Same shape for the previous period of equal length. */
  prevPerf: DailyPerformance | null
  /** One row per day inside [from, to] — the Revenue Trend series. */
  dailyRows: DailyPerformance[]

  /** Range-scoped profit endpoint payload. */
  profit: ProfitData | null
  /** CPA and ROAS exactly as the cards show them (blended, WSZTP excluded). */
  cpa: number | null
  roas: number | null

  /** Per-ad Meta rows for the range, as loaded for the campaign inspector. */
  campaignRows: MetaAdDaily[]
  /** Set when the campaign fetch itself failed, so "no rows" can be explained. */
  campaignError?: string | null

  goals: ReportGoals
}

// ── formatting ───────────────────────────────────────────────────────────────
// fmtPln / fmtNum / fmtRoas are the SAME functions the KPI cards render with
// (src/utils/format.ts), so a figure here is byte-identical to the figure on
// screen. Only the missing-value marker differs: the cards show a dash, which
// is a visual convention; a report has to say BRAK out loud.

const money = (n: number | null | undefined): string => (n == null ? 'BRAK' : fmtPln(n))
const int = (n: number | null | undefined): string => (n == null ? 'BRAK' : fmtNum(Math.round(Number(n))))
const roasFmt = (n: number | null | undefined): string => (n == null ? 'BRAK' : fmtRoas(n))
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`

/** Signed delta against the previous period. "—" when there is nothing to compare. */
function delta(cur: number | null | undefined, prev: number | null | undefined, fmt: (n: number) => string): string {
  if (cur == null || prev == null) return '—'
  const d = cur - prev
  const sign = d > 0 ? '+' : d < 0 ? '−' : '±'
  const rel = prev !== 0 ? ` (${sign}${Math.abs((d / prev) * 100).toFixed(0)}%)` : ''
  return `${sign}${fmt(Math.abs(d))}${rel}`
}

const dayCount = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1

/** TODAY and MONTH are still accumulating; YESTERDAY and WEEK are closed. */
const isInProgress = (range: TimeRange): boolean => range === 'today' || range === 'month'

/** Every Warsaw date in [from, to] inclusive. */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

// ── sections ─────────────────────────────────────────────────────────────────

const RULES = `## ZASADY DANYCH (czytaj przed analizą)
- Wix = jedyne źródło prawdy transakcyjnej. Meta zaniża konwersje.
- Zamówienia nie niosą UTM → atrybucja per reklama jest NIEMOŻLIWA.
  Wszystkie CPA i ROAS są blended (cały ad spend ÷ całość).
- Marże są szacunkowe, z katalogu produktów, nie z faktur.
- Dane brakujące są nazwane wprost. Nie uzupełniaj ich estymacją.`

const TARGETS = `## PROGI I CELE
- PP (Pakiet Pamięciowy): ≥18 zam./dzień zielony, 14–17 żółty, <14 czerwony
- Cel przychodu: 30 000 zł/mies. (prorata do długości zakresu)
- CPA PP: <40 target, >50 alarm, >60 nie skalować
- CPA językowe: 20–25 target
- ROAS: ≥2,0x zdrowy
- Budżet: max +15–20% naraz, jedna zmiana na tydzień`

function summarySection(i: ReportInput): string {
  const p = i.perf
  const prev = i.prevPerf
  const orders = p?.wix_orders ?? null
  const revenue = p?.wix_revenue ?? null
  const spend = p?.meta_spend ?? null
  const profit = i.profit?.ok ? i.profit.estimatedProfitAfterAds : null
  const prevOrders = prev?.wix_orders ?? null
  // AOV is revenue ÷ orders — stated only when both exist.
  const aov = revenue != null && orders != null && orders > 0 ? revenue / orders : null
  const prevAov = prev?.wix_revenue != null && prevOrders != null && prevOrders > 0
    ? prev.wix_revenue / prevOrders : null

  const rows: Array<[string, string, string]> = [
    ['zamówienia',  int(orders),      delta(orders, prevOrders, n => int(n))],
    ['przychód',    money(revenue),   delta(revenue, prev?.wix_revenue, n => money(n))],
    ['ad spend',    money(spend),     delta(spend, prev?.meta_spend, n => money(n))],
    // Est. profit for the previous period is not loaded (profit-data is fetched
    // for the selected range only), so it is not compared rather than compared
    // against a number that does not exist.
    ['est. profit', money(profit),    'BRAK DANYCH: profit-data dla poprzedniego zakresu'],
    ['real CPA',    money(i.cpa),     delta(i.cpa, prev?.real_cpa, n => money(n))],
    ['real ROAS',   roasFmt(i.roas),  delta(i.roas, prev?.real_roas, n => fmtRoas(n))],
    ['AOV',         money(aov),       delta(aov, prevAov, n => money(n))],
  ]

  return [
    '## PODSUMOWANIE',
    '',
    '| metryka | wartość | vs poprzedni zakres |',
    '| --- | --- | --- |',
    ...rows.map(([k, v, d]) => `| ${k} | ${v} | ${d} |`),
  ].join('\n')
}

function dailySection(i: ReportInput): string {
  // A single day needs no day-by-day table — it would repeat PODSUMOWANIE.
  if (i.range === 'today' || i.range === 'yesterday') return ''

  if (i.dailyRows.length === 0) {
    return ['## DZIEŃ PO DNIU', '', `BRAK DANYCH: v_daily_wix_meta_performance (${i.from} → ${i.to})`].join('\n')
  }

  const byDate = new Map(i.dailyRows.map(r => [r.date, r]))
  const lines = datesBetween(i.from, i.to).map(date => {
    const r = byDate.get(date)
    if (!r) return `| ${date} | BRAK DANYCH: v_daily_wix_meta_performance | | | | |`
    const cpa  = r.real_cpa  ?? (r.wix_orders > 0 ? r.meta_spend / r.wix_orders : null)
    const roas = r.real_roas ?? (r.meta_spend > 0 ? r.wix_revenue / r.meta_spend : null)
    return `| ${date} | ${int(r.wix_orders)} | ${money(r.wix_revenue)} | ${money(r.meta_spend)} | ${money(cpa)} | ${roasFmt(roas)} |`
  })

  return [
    '## DZIEŃ PO DNIU',
    '',
    '| data | zam. | przychód | ad spend | CPA | ROAS |',
    '| --- | --- | --- | --- | --- | --- |',
    ...lines,
  ].join('\n')
}

function productsSection(i: ReportInput): string {
  const head = ['## PRODUKTY', '']
  if (!i.profit?.ok) {
    return [...head, 'BRAK DANYCH: /.netlify/functions/profit-data (endpoint nie odpowiedział)'].join('\n')
  }

  const d = i.profit
  const breakdown = d.productBreakdown ?? []

  // marża/szt. is the REALISED margin — marginTotal ÷ units — so the row's own
  // arithmetic closes. Printing the catalog margin here instead would invite the
  // reader to multiply it by the unit count and land on a different total: an
  // order sold below the catalog price earns amount − unit cost, not the catalog
  // figure. Where the two differ, the catalog margin is stated underneath rather
  // than quietly dropped.
  const discounted: string[] = []
  const table = breakdown.length === 0
    ? ['(brak zmapowanych zamówień w tym zakresie)']
    : [
        '| produkt | cena | szt. | przychód | marża/szt. | marża razem | scope |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...breakdown.map(p => {
          const units = p.units ?? p.orders
          const perUnit = units > 0 ? p.marginTotal / units : null
          if (p.contributionMargin != null && perUnit != null
              && Math.abs(perUnit - p.contributionMargin) > 0.005) {
            discounted.push(`  - ${p.displayName}: zrealizowana ${money(perUnit)}/szt. `
              + `vs katalogowa ${money(p.contributionMargin)}/szt. — sprzedaż poza ceną katalogową`)
          }
          return `| ${p.displayName} | ${p.catalogPrice != null ? money(p.catalogPrice) : 'BRAK'} `
            + `| ${int(units)} | ${money(p.revenue)} `
            + `| ${money(perUnit)} `
            + `| ${money(p.marginTotal)} | ${p.scope ?? 'BRAK'} |`
        }),
      ]

  // Two DIFFERENT states, never merged: a gap somebody has to close, and a
  // decision already taken. See netlify/shared/productCatalog.js.
  const noMargin = d.noMarginOrdersCount ?? 0
  const fields = d.noMarginFields ?? []
  const unmapped = noMargin > 0
    ? `- NIEZMAPOWANE: ${int(noMargin)} zamówień, ${money(d.noMarginRevenue)}, marża pominięta, `
      + `brakujące pole: ${fields.length > 0 ? fields.join(' | ') : 'BRAK DANYCH: profit-data.noMarginFields'}`
    : '- NIEZMAPOWANE: brak'

  const excl = d.excludedOrdersCount ?? 0
  const excluded = excl > 0
    ? `- WYKLUCZONE (WSZTP, poza blended): ${int(excl)} zamówień, ${money(d.excludedRevenue)}`
    : '- WYKLUCZONE (WSZTP, poza blended): brak'

  const notes = discounted.length > 0
    ? ['', 'Marża zrealizowana ≠ katalogowa:', ...discounted]
    : []

  return [...head, ...table, ...notes, '', unmapped, excluded].join('\n')
}

function campaignsSection(i: ReportInput): string {
  const head = ['## KAMPANIE META', '']

  if (i.campaignError) {
    return [...head, `BRAK DANYCH: meta_ads_daily — campaign-data zwróciło błąd: ${i.campaignError}`].join('\n')
  }
  if (i.campaignRows.length === 0) {
    return [...head,
      `BRAK DANYCH: meta_ads_daily (campaign_name, spend) dla zakresu ${i.from} → ${i.to}`,
    ].join('\n')
  }

  // Per-ad rows roll up to campaigns. Scope reads the ad AND campaign name, the
  // same way the Campaigns panel classifies them.
  const byCampaign = new Map<string, { spend: number; scope: string }>()
  for (const r of i.campaignRows) {
    const name = r.campaign_name ?? r.campaign_id ?? 'BRAK DANYCH: campaign_name'
    const scope = classifyCampaignScope(`${r.ad_name ?? ''} ${r.campaign_name ?? ''}`)
    const prev = byCampaign.get(name)
    byCampaign.set(name, {
      spend: (prev?.spend ?? 0) + (r.spend ?? 0),
      // A campaign whose ads disagree on scope keeps the first non-ALL verdict.
      scope: prev && prev.scope !== 'ALL' ? prev.scope : scope,
    })
  }

  const total = [...byCampaign.values()].reduce((s, c) => s + c.spend, 0)
  const SCOPE_LABEL: Record<string, string> = { JSU: 'PP-', JZK: '3T-', ALL: 'unknown' }

  const rows = [...byCampaign.entries()]
    .sort((a, b) => b[1].spend - a[1].spend)
    .map(([name, c]) =>
      `| ${name} | ${money(c.spend)} | ${total > 0 ? pct(c.spend / total) : 'BRAK'} | ${SCOPE_LABEL[c.scope] ?? c.scope} |`)

  return [...head,
    '| kampania | wydatek | udział % | scope (PP-/3T-/unknown) |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    `Razem: ${money(total)} w ${rows.length} kampaniach.`,
  ].join('\n')
}

function goalsSection(i: ReportInput): string {
  const g = i.goals
  const ppValue = g.ppOrders == null ? 'BRAK' : int(g.ppOrders)
  return [
    '## REALIZACJA CELÓW',
    '',
    `- PP orders: ${ppValue} / ${int(g.ppTarget)} (${g.pp.status} — ${g.pp.note})`,
    `- przychód: ${money(i.perf?.wix_revenue)} / ${money(g.revenueTarget)} (${g.revenue.status} — ${g.revenue.note})`,
    `- CPA: ${money(i.cpa)} (${g.cpa.status} — ${g.cpa.note})`,
    `- ROAS: ${roasFmt(i.roas)} (${g.roas.status} — ${g.roas.note})`,
  ].join('\n')
}

function gapsSection(i: ReportInput): string {
  const gaps: string[] = []

  // Days inside the range with no row in the daily view at all.
  const have = new Set(i.dailyRows.map(r => r.date))
  const missing = datesBetween(i.from, i.to).filter(d => !have.has(d))
  if (i.dailyRows.length > 0 && missing.length > 0) {
    gaps.push(`- brak wiersza w v_daily_wix_meta_performance: ${missing.join(', ')}`)
  }
  if (i.dailyRows.length === 0 && i.range !== 'today' && i.range !== 'yesterday') {
    gaps.push(`- brak jakichkolwiek wierszy dziennych dla ${i.from} → ${i.to}`)
  }

  // Days present but with zero Meta spend — ads off, or the ingest did not run.
  const noSpend = i.dailyRows.filter(r => (r.meta_spend ?? 0) === 0).map(r => r.date)
  if (noSpend.length > 0) {
    gaps.push(`- meta_spend = 0 (reklamy wyłączone albo ingest Meta nie zadziałał): ${noSpend.join(', ')}`)
  }

  if (i.campaignError) {
    gaps.push(`- campaign-data niedostępne: ${i.campaignError}`)
  } else if (i.campaignRows.length === 0) {
    gaps.push(`- brak wierszy per kampania (meta_ads_daily) w tym zakresie`)
  }

  if (i.profit?.ok) {
    const noMargin = i.profit.noMarginOrdersCount ?? 0
    if (noMargin > 0) {
      gaps.push(`- ${int(noMargin)} zamówień bez marży (${money(i.profit.noMarginRevenue)}), `
        + `pola: ${(i.profit.noMarginFields ?? []).join(' | ') || 'nieraportowane'}`)
    }
    const boundary = i.profit.dayBoundaryOrders ?? 0
    if (boundary > 0) {
      gaps.push(`- ${int(boundary)} zamówień w oknie 22:00–24:00 UTC: widok dzienny liczy je `
        + `o dzień wcześniej niż ten raport (widok tnie dobę po UTC, raport po Warszawie)`)
    }
  } else {
    gaps.push('- profit-data niedostępne: brak marży, zysku, produktów i wykluczeń')
  }

  return ['## ZNANE DZIURY W DANYCH', '', ...(gaps.length > 0 ? gaps : ['brak'])].join('\n')
}

// ── the one entry point ──────────────────────────────────────────────────────

export function buildReport(i: ReportInput): string {
  const days = dayCount(i.from, i.to)
  const state = isInProgress(i.range) ? 'w toku' : 'pełny'

  const sections = [
    `# STANLEY HQ — RAPORT ${RANGE_LABELS[i.range]}`,
    `Zakres: ${i.from} – ${i.to} (${days} ${days === 1 ? 'dzień' : 'dni'}, ${state})`,
    `Wygenerowano: ${i.generatedAt}`,
    `Build: ${i.buildHash}`,
    '',
    RULES,
    '',
    TARGETS,
    '',
    summarySection(i),
  ]

  const daily = dailySection(i)
  if (daily) sections.push('', daily)

  sections.push(
    '', productsSection(i),
    '', campaignsSection(i),
    '', goalsSection(i),
    '', gapsSection(i),
  )

  return sections.join('\n') + '\n'
}
