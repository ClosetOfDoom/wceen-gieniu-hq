// financeStore.js — the ONLY reader of the private Supabase bucket "ksiegowosc" (monthly
// accounting aggregates published by the ksiegowosc-wceen report).
//
//   index.json                      list of published months with source statuses
//   RRRR-MM/summary_RRRR-MM.json    aggregates in grosze, no personal data
//
// One client, no parallel paths: the get_finance tool (gieniu-command) and the finance-data
// function both go through getFinance(). The service-role key is read from the server
// environment here and never leaves it — it is not returned, logged or put in an error.
//
// buildFinanceView() is pure. It does the arithmetic (percentages, month-on-month change,
// anomalies, statuses) so the model only transcribes: Stanley must never invent a figure.

import { blocksToText } from './financeBlocks.js'

export const BUCKET = 'ksiegowosc'
export const MAX_MONTHS = 6
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const SCHEMA_VERSION = 1
/** Fewer events of a kind than this in either compared period: no percentage change and no talk of a trend. */
export const MIN_EVENTS = 5

export const SOURCE_KEYS = ['stripe', 'p24', 'paypal', 'meta']

const SOURCE_LABEL = { stripe: 'STRIPE', p24: 'PRZELEWY24', paypal: 'PAYPAL', meta: 'META_ADS' }
const SCOPE_LABEL = { PP: 'PP (memory)', '3T': '3T (languages)', COGNI: 'COGNI', NIEPRZYPISANE: 'unassigned' }

export const LIMITS = [
  'These are inflows from payment operators (Stripe, P24, PayPal), not Wix sales. Wix remains the transactional truth for orders and revenue.',
  'Meta spend from Insights and the Meta charges paid through PayPal are the same cost seen two ways: never add them together.',
  'A month with closed:false is not closed and must not be compared with a full month.',
  'Bank costs and subscriptions: I don\'t have that data: no audit published.',
]

export const NOT_PUBLISHED_ANSWER = 'I don\'t have that data: no audit published'

// ── money / percent helpers (integers only) ──────────────────────────────────────────────

export function fmt(grosze) {
  const abs = Math.abs(grosze)
  const digits = String(abs).padStart(3, '0')
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${grosze < 0 ? '-' : ''}${whole},${digits.slice(-2)}`
}

export function money(grosze, currency = 'PLN') {
  return `${fmt(grosze)} ${currency === 'PLN' ? 'zł' : currency}`
}

function signedMoney(grosze, currency) {
  return `${grosze > 0 ? '+' : ''}${money(grosze, currency)}`
}

/** One decimal, comma separator, from integer numerator/denominator; null when the denominator is 0. */
export function pct(numerator, denominator, signed = false) {
  if (denominator === 0) return null
  const tenths = Math.round((numerator * 1000) / denominator)
  const abs = Math.abs(tenths)
  return `${tenths < 0 ? '-' : signed && tenths > 0 ? '+' : ''}${Math.floor(abs / 10)},${abs % 10}%`
}

/** Rate in tenths of a percent (integer) for comparisons. */
const tenths = (numerator, denominator) => (denominator === 0 ? null : Math.round((numerator * 1000) / denominator))

export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function summaryPath(month) {
  return `${month}/summary_${month}.json`
}

// ── storage client ─────────────────────────────────────────────────────────────────────

export class FinanceError extends Error {}
/** The caller asked for something invalid (HTTP 400), as opposed to a server-side/read failure. */
export class RequestError extends FinanceError {}

export function readFinanceConfig(env = process.env) {
  const url = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !key) throw new FinanceError('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in the function environment')
  if (!url.startsWith('https://')) throw new FinanceError('SUPABASE_URL must start with https://')
  return { url, key }
}

/** JSON object from the bucket, or null when it does not exist. Errors never contain the key. */
export async function getJson(config, path, fetchFn = fetch) {
  const res = await fetchFn(`${config.url}/storage/v1/object/authenticated/${BUCKET}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
    signal: AbortSignal.timeout(8000),
  })
  if (res.ok) {
    try {
      return await res.json()
    } catch {
      throw new FinanceError(`plik ${BUCKET}/${path} nie jest poprawnym JSON`)
    }
  }
  const text = await res.text().catch(() => '')
  if (res.status === 404 || /not.?found|"statusCode":"404"/i.test(text)) return null
  throw new FinanceError(`odczyt ${BUCKET}/${path}: HTTP ${res.status}`)
}

/** Reads index.json and the requested summaries plus the month before each (for change vs previous). */
export async function loadFinance(config, months, fetchFn = fetch) {
  const wanted = [...new Set(months.flatMap((m) => [m, previousMonth(m)]))]
  const [index, ...summaries] = await Promise.all([
    getJson(config, 'index.json', fetchFn),
    ...wanted.map((m) => getJson(config, summaryPath(m), fetchFn)),
  ])
  return { index, summaries: new Map(wanted.map((m, i) => [m, summaries[i] ?? null])) }
}

// ── pure view ──────────────────────────────────────────────────────────────────────────

const STATUS_RANK = { OK: 0, INCOMPLETE: 1, WARNING: 2 }
const worst = (a, b) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b)

function sourceMeta(summary, key) {
  const label = SOURCE_LABEL[key]
  const entry = (summary.sources ?? []).find((s) => s.name === label)
  const failed = (summary.checks ?? []).filter((c) => c.ok === false && String(c.name).startsWith(label))
  if (!entry) return { status: 'INCOMPLETE', reasons: [`source ${label} is not in sources`], present: false }
  const reasons = []
  let status = 'OK'
  if (entry.status !== 'OK') {
    status = 'INCOMPLETE'
    reasons.push(`${label}: BRAK_DANYCH${entry.reason ? ` — ${entry.reason}` : ''}`)
  }
  if (failed.length > 0) {
    status = 'WARNING'
    for (const c of failed) reasons.push(`check failed: ${c.name} (difference ${c.diff})`)
  }
  if (summary.closed === false && status === 'OK') {
    status = 'INCOMPLETE'
    reasons.push('month not closed (data up to the generation day)')
  }
  return { status, reasons, present: entry.status === 'OK' }
}

function flowsView(f) {
  const cur = f.currency
  const out = {
    currency: cur,
    payments: f.paymentsCount,
    avgPayment: f.paymentsCount > 0 ? money(Math.round(f.gross / f.paymentsCount), cur) : 'n/a (0 payments)',
    refundsCount: Number.isInteger(f.refundsCount) ? f.refundsCount : 'n/a: not in the file (refundsCount field)',
    refundsShareOfPayments: Number.isInteger(f.refundsCount) && f.paymentsCount > 0 ? pct(f.refundsCount, f.paymentsCount) : 'n/a (the number of refunds is not in the file)',
    gross: money(f.gross, cur),
    refunds: money(f.refunds, cur),
    disputes: money(f.disputes, cur),
    fees: f.fees === null ? 'n/a: not in the file (fees come from the operator invoice)' : money(f.fees, cur),
    otherFees: money(f.otherFees, cur),
    ...(f.climate ? { stripeClimate: money(f.climate, cur) } : {}),
    ...(f.other ? { otherOperations: money(f.other, cur) } : {}),
    ...(f.outgoing ? { outgoingPayments: money(f.outgoing, cur) } : {}),
    ...(f.topUps ? { topUps: money(f.topUps, cur) } : {}),
    net: money(f.net, cur),
    netNote: f.fees === null ? 'net without fees (fees are not in the file)' : undefined,
    payouts: `${money(f.payoutsSum, cur)} (${f.payoutsCount} ${f.payoutsCount === 1 ? 'payout' : 'payouts'})`,
    refundsPctOfGross: pct(f.refunds, f.gross) ?? 'n/a (gross 0)',
    feesPctOfGross: f.fees === null ? null : pct(f.fees, f.gross) ?? 'n/a (gross 0)',
  }
  if (f.opening !== null && f.closing !== null) {
    out.balance = `${money(f.opening, cur)} → ${money(f.closing, cur)}`
  }
  return JSON.parse(JSON.stringify(out)) // drop undefined
}

/** Raw (integer) numbers of the PLN section used for deltas. */
function rawOf(summary, key) {
  const section = key === 'paypal' ? summary.paypal?.byCurrency?.find((c) => c.currency === 'PLN') : summary[key]
  return section ?? null
}

function changeVsPrevious(month, summary, previous, key) {
  if (!previous) return { comparable: false, reason: `no file ${summaryPath(previousMonth(month))} (the previous month is not published)` }
  if (summary.closed === false) return { comparable: false, vs: previous.month, reason: `${month} is not closed — I do not compare it with a full month` }
  if (previous.closed === false) return { comparable: false, vs: previous.month, reason: `${previous.month} is not closed` }
  const a = rawOf(summary, key)
  const b = rawOf(previous, key)
  const sa = sourceMeta(summary, key)
  const sb = sourceMeta(previous, key)
  if (!a || !b || sa.status === 'INCOMPLETE' || sb.status === 'INCOMPLETE') {
    return { comparable: false, vs: previous.month, reason: `no complete ${SOURCE_LABEL[key]} data in one of the months (${month}: ${sa.status}, ${previous.month}: ${sb.status})` }
  }
  const line = (cur, prev, currency) => `${money(prev, currency)} → ${money(cur, currency)} (${signedMoney(cur - prev, currency)}, ${pct(cur - prev, Math.abs(prev), true) ?? 'n/a (no base)'})`
  const lineNoPct = (cur, prev, currency) => `${money(prev, currency)} → ${money(cur, currency)} (${signedMoney(cur - prev, currency)})`
  // Small-sample rule: fewer than MIN_EVENTS events of a kind in either period → no percentage change, no trend.
  const paySmall = a.paymentsCount < MIN_EVENTS || b.paymentsCount < MIN_EVENTS
  const refKnown = Number.isInteger(a.refundsCount) && Number.isInteger(b.refundsCount)
  const refSmall = !refKnown || a.refundsCount < MIN_EVENTS || b.refundsCount < MIN_EVENTS
  const paySample = `too few events (payments ${b.paymentsCount} → ${a.paymentsCount}) — no percentage change`
  const out = {
    comparable: true,
    vs: previous.month,
    gross: paySmall ? `${lineNoPct(a.gross, b.gross, a.currency)}; ${paySample}` : line(a.gross, b.gross, a.currency),
    refunds: !refSmall
      ? line(a.refunds, b.refunds, a.currency)
      : refKnown
        ? `${lineNoPct(a.refunds, b.refunds, a.currency)}; too few events (refunds ${b.refundsCount} → ${a.refundsCount}) — no percentage change and no trend`
        : `${lineNoPct(a.refunds, b.refunds, a.currency)}; number of refunds unknown (no refundsCount field in the file) — no percentage change, this is not a trend`,
    net: paySmall ? `${lineNoPct(a.net, b.net, a.currency)}; ${paySample}` : line(a.net, b.net, a.currency),
    payments: `${b.paymentsCount} → ${a.paymentsCount}`,
    avgPayment: a.paymentsCount > 0 && b.paymentsCount > 0 ? `${money(Math.round(b.gross / b.paymentsCount), a.currency)} → ${money(Math.round(a.gross / a.paymentsCount), a.currency)}` : 'n/a (0 payments in one of the months)',
    sample: { payments: paySmall ? { small: true, n: `${b.paymentsCount} → ${a.paymentsCount}` } : { small: false }, refunds: !refSmall ? { small: false } : { small: true, n: refKnown ? `${b.refundsCount} → ${a.refundsCount}` : null } },
  }
  if (a.fees !== null && b.fees !== null) {
    out.fees = line(a.fees, b.fees, a.currency)
    const ra = tenths(a.fees, a.gross)
    const rb = tenths(b.fees, b.gross)
    if (ra !== null && rb !== null) out.feesPctOfGross = `${pct(b.fees, b.gross)} → ${pct(a.fees, a.gross)}`
  } else {
    out.fees = 'n/a: no fees in the file (one of the months), not compared'
  }
  return out
}

function anomaliesFor(month, summary, previous, key, meta) {
  const label = SOURCE_LABEL[key]
  const out = []
  if (meta.status === 'WARNING') out.push(`${month} ${label}: status WARNING — ${meta.reasons.join('; ')}`)
  const a = rawOf(summary, key)
  if (a && meta.present) {
    const refundRate = tenths(a.refunds, a.gross)
    if (a.refunds > 0 && refundRate !== null && refundRate >= 20) out.push(`${month} ${label}: refunds ${money(a.refunds, a.currency)} = ${pct(a.refunds, a.gross)} of gross (attention threshold 2,0%)`)
    if (a.disputes > 0) out.push(`${month} ${label}: spory/blokady ${money(a.disputes, a.currency)}`)
    if (summary.closed !== false && previous && previous.closed !== false) {
      const b = rawOf(previous, key)
      if (b && a.fees !== null && b.fees !== null) {
        const ra = tenths(a.fees, a.gross)
        const rb = tenths(b.fees, b.gross)
        if (ra !== null && rb !== null && ra - rb >= 3) out.push(`${month} ${label}: fee growth in gross ${pct(b.fees, b.gross)} → ${pct(a.fees, a.gross)} (attention threshold +0,3 pp)`)
      }
      if (b && b.gross > 0) {
        const change = tenths(a.gross - b.gross, b.gross)
        if (change !== null && Math.abs(change) >= 300) out.push(`${month} ${label}: gross changed by ${pct(a.gross - b.gross, b.gross, true)} compared with ${previous.month}`)
      }
    }
  }
  return out
}

function metaView(month, summary, previous) {
  const insights = sourceMeta(summary, 'meta')
  const paypal = sourceMeta(summary, 'paypal')
  const charges = summary.meta?.paypalCharges ?? []
  const chargeSums = summary.meta?.paypalChargesSum ?? []
  const spend = summary.meta?.insightsSpendByScope ?? []
  const currencies = [...new Set(spend.map((s) => s.currency))]
  const status = worst(insights.status, paypal.status)
  const view = {
    status,
    insights: {
      source: 'META_ADS (Insights)',
      status: insights.status,
      ...(insights.reasons.length ? { reasons: insights.reasons } : {}),
      ...(insights.present
        ? {
            byScope: spend.map((s) => ({ scope: SCOPE_LABEL[s.scope] ?? s.scope, rows: s.rows, spend: money(s.spend, s.currency) })),
            total: Object.fromEntries(currencies.map((c) => [c, money(spend.filter((s) => s.currency === c).reduce((n, s) => n + s.spend, 0), c)])),
          }
        : {}),
    },
    paypalCharges: {
      source: 'PAYPAL (charges for Meta ads)',
      status: paypal.status,
      ...(paypal.reasons.length ? { reasons: paypal.reasons } : {}),
      ...(paypal.present
        ? {
            list: charges.map((c) => `${c.date}  ${money(c.amount, c.currency)}`),
            sum: chargeSums.map((s) => `${money(s.amount, s.currency)} (${s.count} ${s.count === 1 ? 'payment' : 'payments'})`),
          }
        : {}),
    },
    rule: 'THE SAME COST SEEN TWO WAYS (Insights = spend according to the Meta panel, PayPal = the actual charges). Show them separately, NEVER add them together. Insights is not the amount charged (billing thresholds, dates); the cost document is the Meta invoice.',
  }
  // Change vs previous month, per view (not summed together).
  if (summary.closed !== false && previous && previous.closed !== false && insights.present && sourceMeta(previous, 'meta').present) {
    const cur = (summary.meta?.insightsSpendByScope ?? []).filter((s) => s.currency === 'PLN').reduce((n, s) => n + s.spend, 0)
    const prev = (previous.meta?.insightsSpendByScope ?? []).filter((s) => s.currency === 'PLN').reduce((n, s) => n + s.spend, 0)
    view.insights.changeVsPrevious = `${previous.month}: ${money(prev)} → ${money(cur)} (${signedMoney(cur - prev, 'PLN')}, ${pct(cur - prev, Math.abs(prev), true) ?? 'n/a (no base)'})`
  } else {
    view.insights.changeVsPrevious = summary.closed === false ? 'not compared: month not closed' : 'no complete data for the previous month'
  }
  return view
}

function openNote(summary) {
  const note = (summary.notes ?? []).find((n) => String(n).startsWith('MIESIĄC NIEZAMKNIĘTY'))
  // the file's own note (Polish: "MIESIĄC NIEZAMKNIĘTY — dane do <date>") is only read for the date
  const when = /dane do\s+(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/i.exec(String(note ?? ''))
  return `MONTH NOT CLOSED${when ? ` — data up to ${when[1]}` : ''}`
}

/**
 * Tool result. `months`: validated YYYY-MM list. `source`: one of SOURCE_KEYS or undefined (= all).
 * Everything a month lacks is listed in `missing` with the file or field name.
 */
export function buildFinanceView({ index, summaries, months, source }) {
  const keys = source ? [source] : SOURCE_KEYS
  const published = (index?.months ?? []).map((m) => ({
    month: m.month,
    closed: m.closed,
    sources: (m.sources ?? []).map((s) => `${s.name}=${s.status}`).join(', '),
  }))
  const result = {
    publishedMonths: published,
    indexAvailable: index !== null && index !== undefined,
    ...(index ? {} : { missing: [`${BUCKET}/index.json — I don't have that data: not published`] }),
    months: [],
    limits: LIMITS,
    notPublished: `bank costs, subscriptions, bank fees: ${NOT_PUBLISHED_ANSWER}`,
    statusRule: 'OK = source OK, checks ✔, month closed; INCOMPLETE = source BRAK_DANYCH (no data) or month not closed; WARNING = a check failed.',
  }
  for (const month of months) {
    const summary = summaries.get(month)
    if (!summary) {
      result.months.push({
        month,
        available: false,
        missing: `${BUCKET}/${summaryPath(month)} — I don't have that data: the month is not published`,
      })
      continue
    }
    if (summary.schemaVersion !== SCHEMA_VERSION) {
      result.months.push({ month, available: false, missing: `${summaryPath(month)}: unsupported schema version (${summary.schemaVersion})` })
      continue
    }
    const previous = summaries.get(previousMonth(month)) ?? null
    const view = {
      month,
      available: true,
      closed: summary.closed,
      generatedAt: summary.generatedAt,
      ...(summary.closed === false
        ? { warning: `${openNote(summary)}. Do not compare with a full month; this is partial data.` }
        : {}),
      sources: {},
      anomalies: [],
      missing: [],
    }
    for (const key of keys) {
      if (key === 'meta') {
        const meta = metaView(month, summary, previous)
        view.sources.meta = meta
        view.anomalies.push(...(meta.status === 'WARNING' ? [`${month} META: status WARNING`] : []))
        for (const part of [meta.insights, meta.paypalCharges]) {
          if (part.status === 'INCOMPLETE' && part.reasons?.length && !('byScope' in part) && !('list' in part)) {
            view.missing.push(`${summaryPath(month)} → ${part.source}: I don't have that data (${part.reasons.join('; ')})`)
          }
        }
        continue
      }
      const meta = sourceMeta(summary, key)
      const section = key === 'paypal' ? summary.paypal : summary[key]
      const entry = { source: SOURCE_LABEL[key], month, status: meta.status, ...(meta.reasons.length ? { statusReasons: meta.reasons } : {}) }
      if (!meta.present || !section) {
        entry.data = null
        view.missing.push(`${summaryPath(month)} → ${key} (${SOURCE_LABEL[key]}): I don't have that data${meta.reasons.length ? ` — ${meta.reasons.join('; ')}` : ''}`)
      } else if (key === 'paypal') {
        entry.byCurrency = section.byCurrency.map(flowsView)
        entry.changeVsPrevious = changeVsPrevious(month, summary, previous, key)
      } else {
        entry.data = flowsView(section)
        if (section.otherCurrencies?.length) entry.otherCurrencies = section.otherCurrencies.map(flowsView)
        entry.changeVsPrevious = changeVsPrevious(month, summary, previous, key)
      }
      view.sources[key] = entry
      view.anomalies.push(...anomaliesFor(month, summary, previous, key, meta))
    }
    for (const n of summary.notes ?? []) {
      if (/Zbudowano z archiwalnego pliku/.test(n)) view.sourceNote = n
    }
    result.months.push(view)
  }
  return result
}

// ── public entry ───────────────────────────────────────────────────────────────────────

export function validateRequest({ months, source } = {}) {
  const list = Array.isArray(months) ? months : typeof months === 'string' ? months.split(',') : []
  const trimmed = list.map((m) => String(m).trim()).filter(Boolean)
  const invalid = trimmed.filter((m) => !MONTH_RE.test(m))
  if (invalid.length > 0) throw new RequestError(`invalid month: ${invalid.join(', ')} (expected format YYYY-MM)`)
  const unique = [...new Set(trimmed)].sort()
  if (unique.length > MAX_MONTHS) throw new RequestError(`at most ${MAX_MONTHS} months at once`)
  const src = source ? String(source).trim().toLowerCase() : undefined
  if (src && !SOURCE_KEYS.includes(src)) throw new RequestError(`unknown source: ${src} (allowed: ${SOURCE_KEYS.join(', ')})`)
  return { months: unique, source: src || undefined }
}

export async function getFinance(request, { env = process.env, fetchFn = fetch } = {}) {
  const { months, source } = validateRequest(request)
  const config = readFinanceConfig(env)
  const { index, summaries } = await loadFinance(config, months, fetchFn)
  return buildFinanceView({ index, summaries, months, source })
}

// ── report text (deterministic) ────────────────────────────────────────────────────────
// Tables, statuses, changes, anomalies and gaps are rendered HERE, not by the model: a smaller
// model dropped statuses and the "I don't have that data" file names. Stanley's text is a comment
// placed after this report.

/** Several tool results (e.g. stripe and p24 asked separately) merged by month. */
export function mergeViews(views) {
  if (views.length === 1) return views[0]
  const merged = { ...views[0], months: [], anomalies: undefined }
  const byMonth = new Map()
  for (const v of views) {
    for (const m of v.months) {
      const have = byMonth.get(m.month)
      if (!have) {
        byMonth.set(m.month, { ...m, sources: { ...(m.sources ?? {}) }, anomalies: [...(m.anomalies ?? [])], missing: [...(m.missing ?? [])] })
      } else if (m.available && have.available) {
        Object.assign(have.sources, m.sources)
        have.anomalies = [...new Set([...have.anomalies, ...m.anomalies])]
        have.missing = [...new Set([...have.missing, ...m.missing])]
      }
    }
  }
  merged.months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
  return merged
}

const feesCell = (d) => (String(d.fees).startsWith('n/a') ? 'n/a (not in the file)' : d.fees)

function tableRows(m) {
  const rows = []
  const label = `${m.month}${m.closed === false ? '*' : ''}`
  const push = (name, status, d) => rows.push({ cells: [label, name, status, d.gross, d.refunds, feesCell(d), d.net], status })
  for (const key of ['stripe', 'p24', 'paypal']) {
    const s = m.sources[key]
    if (!s) continue
    if (s.data) {
      push(s.source, s.status, s.data)
      for (const other of s.otherCurrencies ?? []) push(`${s.source} ${other.currency}`, s.status, other)
    } else if (s.byCurrency) {
      for (const d of s.byCurrency) push(d.currency === 'PLN' ? s.source : `${s.source} ${d.currency}`, s.status, d)
    } else {
      rows.push({ cells: [label, s.source, s.status, '—', '—', '—', '—'], status: s.status })
    }
  }
  return rows
}

const noData = (v) => v === null || v === undefined || String(v).startsWith('n/a')

/** Derived metrics per source and month: payments, average payment, refunds count and share, fees as % of gross. Computed in flowsView from raw numbers. */
function metricRows(m) {
  const rows = []
  const label = `${m.month}${m.closed === false ? '*' : ''}`
  const push = (name, d) => rows.push([
    label, name, String(d.payments), d.avgPayment,
    noData(d.refundsCount) ? 'n/a (not in the file)' : String(d.refundsCount),
    noData(d.refundsShareOfPayments) ? 'n/a' : d.refundsShareOfPayments,
    noData(d.feesPctOfGross) ? 'n/a (not in the file)' : d.feesPctOfGross,
  ])
  for (const key of ['stripe', 'p24', 'paypal']) {
    const s = m.sources[key]
    if (!s) continue
    if (s.data) {
      push(s.source, s.data)
      for (const other of s.otherCurrencies ?? []) push(`${s.source} ${other.currency}`, other)
    } else if (s.byCurrency) {
      for (const d of s.byCurrency) push(d.currency === 'PLN' ? s.source : `${s.source} ${d.currency}`, d)
    }
  }
  return rows
}

const dataOf = (s) => (s.data ? [s.data, ...(s.otherCurrencies ?? [])] : (s.byCurrency ?? []))

/** The report as structured blocks (see financeBlocks.js). renderReport() is blocksToText() of this — one source of figures and wording. */
export function buildReportBlocks(view) {
  const blocks = []
  const open = view.months.filter((m) => m.available && m.closed === false)
  const rows = view.months.flatMap((m) => (m.available ? tableRows(m) : []))
  if (rows.length > 0) {
    const keys = ['month', 'source', 'status', 'gross', 'refunds', 'fees', 'net']
    const labels = ['Month', 'Source', 'Status', 'Gross', 'Refunds', 'Fees', 'Net']
    blocks.push({
      type: 'table',
      title: 'TOTALS (payment-operator inflows, not Wix sales)',
      columns: labels.map((label, i) => ({ key: keys[i], label, align: i < 3 ? 'left' : 'right' })),
      rows,
    })
    const notes = []
    for (const m of view.months.filter((x) => x.available)) {
      const payouts = ['stripe', 'p24', 'paypal'].flatMap((key) => {
        const s = m.sources[key]
        if (!s) return []
        return dataOf(s).filter((d) => !d.payouts.startsWith('0,00')).map((d) => `${s.source}${d.currency === 'PLN' ? '' : ` ${d.currency}`}: ${d.payouts}`)
      })
      if (payouts.length > 0) notes.push('', `Payouts to the account ${m.month}: ${payouts.join('; ')}`)
      for (const key of ['stripe', 'p24']) {
        const s = m.sources[key]
        if (s?.data && String(s.data.fees).startsWith('n/a')) {
          notes.push(`${s.source} ${m.month}: fees are not in the file (the operator's invoice settles them), so net = gross − refunds, without fees.`)
        }
      }
      const pp = m.sources.paypal?.byCurrency?.find((d) => d.currency === 'PLN')
      if (pp && (pp.outgoingPayments || pp.topUps)) {
        notes.push(`PAYPAL ${m.month}: net also includes outgoing payments (${pp.outgoingPayments ?? '0,00 zł'}) and balance top-ups (${pp.topUps ?? '0,00 zł'}).`)
      }
    }
    if (notes.length > 0) blocks.push({ type: 'text', role: 'notes', lines: notes })

    const metrics = view.months.flatMap((m) => (m.available ? metricRows(m) : []))
    if (metrics.length > 0) {
      const mkeys = ['month', 'source', 'payments', 'avg', 'refundsCount', 'refundsShare', 'feesPct']
      const mlabels = ['Month', 'Source', 'Payments', 'Avg. payment', 'Refunds (count)', 'Refunds / payments', 'Fees / gross']
      blocks.push({
        type: 'table',
        lead: true,
        title: 'DERIVED METRICS (computed on the server from the report data)',
        columns: mlabels.map((label, i) => ({ key: mkeys[i], label, align: i < 2 ? 'left' : 'right' })),
        rows: metrics.map((cells) => ({ cells })),
      })
      const lines = []
      const shown = view.months.filter((m) => m.available).flatMap((m) => ['stripe', 'p24', 'paypal'].map((k) => m.sources[k]).filter(Boolean))
      if (shown.some((s) => dataOf(s).some((d) => noData(d.refundsCount)))) {
        lines.push('The number of refunds is not in the summary file (no refundsCount field): I do not treat changes in the refund amount as a trend and give no percentage change for them.')
      }
      if (view.months.some((m) => m.available && m.sources.stripe)) {
        lines.push('Stripe also covers payments outside Wix (e.g. Cogni); the file has no split of gross by product or sales source, so I do not attribute a rise in gross to Wix sales.')
      }
      if (lines.length > 0) blocks.push({ type: 'text', role: 'notes', lines })
    }
  }
  for (const m of view.months.filter((x) => x.available && x.sources.meta)) {
    const { insights, paypalCharges } = m.sources.meta
    blocks.push({
      type: 'text',
      role: 'meta',
      lines: [
        '',
        `META ${m.month}${m.closed === false ? '*' : ''} — status ${m.sources.meta.status} (two views of the SAME cost — do not add)`,
        `  spend per Insights (Meta panel) [${insights.status}]: ${insights.total ? Object.values(insights.total).join(' / ') : `I don't have that data: ${(insights.reasons ?? []).join('; ') || 'none'}`}`,
        `  charges through PayPal [${paypalCharges.status}]: ${paypalCharges.sum ? paypalCharges.sum.join(' / ') : `I don't have that data: ${(paypalCharges.reasons ?? []).join('; ') || 'none'}`}`,
      ],
    })
  }
  if (open.length > 0) blocks.push({ type: 'text', role: 'warning', lines: ['', ...open.map((m) => `* ${m.warning}`)] })

  const changes = view.months.filter((m) => m.available).flatMap((m) =>
    ['stripe', 'p24', 'paypal'].flatMap((key) => {
      const c = m.sources[key]?.changeVsPrevious
      if (!c) return []
      const name = `${m.month} ${m.sources[key].source}`
      return c.comparable
        ? [`${name} vs ${c.vs}: gross ${c.gross}; refunds ${c.refunds}; fees ${c.fees}${c.feesPctOfGross ? ` (share of gross ${c.feesPctOfGross})` : ''}; net ${c.net}; payments ${c.payments}; avg. payment ${c.avgPayment}`]
        : [`${name}: no comparison — ${c.reason}`]
    }),
  )
  const metaChanges = view.months.filter((m) => m.available && m.sources.meta).map((m) => `${m.month} META Insights: ${m.sources.meta.insights.changeVsPrevious}`)
  const all = [...changes, ...metaChanges]
  blocks.push({
    type: 'list',
    title: 'CHANGE VS THE PREVIOUS MONTH',
    items: (all.length ? all : ['no data to compare']).map((text) => ({ text })),
  })

  const anomalies = view.months.filter((m) => m.available).flatMap((m) => m.anomalies)
  blocks.push({
    type: 'list',
    title: 'ANOMALIES (thresholds: refunds ≥ 2,0% of gross, fee growth ≥ 0,3 pp, change in gross ≥ 30%, status WARNING)',
    items: anomalies.length ? anomalies.map((text) => ({ text, kind: 'warn' })) : [{ text: 'no anomalies detected' }],
  })

  const missing = [...(view.missing ?? []), ...view.months.flatMap((m) => (m.available ? m.missing : [m.missing]))]
  blocks.push({
    type: 'list',
    title: 'DATA GAPS',
    items: (missing.length ? missing : ['none in the requested range']).map((text) => ({ text })),
  })
  blocks.push({ type: 'text', role: 'footer', lines: ['', 'Wix remains the transactional truth for orders and revenue; the above are inflows from payment operators.'] })
  return blocks
}

export function renderReport(view) {
  return blocksToText(buildReportBlocks(view))
}
