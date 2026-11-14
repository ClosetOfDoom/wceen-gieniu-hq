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

export const BUCKET = 'ksiegowosc'
export const MAX_MONTHS = 6
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const SCHEMA_VERSION = 1

export const SOURCE_KEYS = ['stripe', 'p24', 'paypal', 'meta']

const SOURCE_LABEL = { stripe: 'STRIPE', p24: 'PRZELEWY24', paypal: 'PAYPAL', meta: 'META_ADS' }
const SCOPE_LABEL = { PP: 'PP (pamięć)', '3T': '3T (języki)', COGNI: 'COGNI', NIEPRZYPISANE: 'nieprzypisane' }

export const LIMITS = [
  'To są wpływy od operatorów płatności (Stripe, P24, PayPal), a nie sprzedaż z Wix. Wix pozostaje prawdą transakcyjną dla zamówień i przychodu.',
  'Wydatki Meta z Insights i obciążenia Meta opłacone przez PayPal to ten sam koszt w dwóch ujęciach — nigdy ich nie sumować.',
  'Miesiąc z closed:false jest niezamknięty i nie wolno go porównywać z pełnym miesiącem.',
  'Koszty z banku i subskrypcje: nie mam tych danych: brak publikacji audytu.',
]

export const NOT_PUBLISHED_ANSWER = 'nie mam tych danych: brak publikacji audytu'

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
  if (!url || !key) throw new FinanceError('brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w środowisku funkcji')
  if (!url.startsWith('https://')) throw new FinanceError('SUPABASE_URL musi zaczynać się od https://')
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

const STATUS_RANK = { OK: 0, NIEPEŁNY: 1, UWAGA: 2 }
const worst = (a, b) => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b)

function sourceMeta(summary, key) {
  const label = SOURCE_LABEL[key]
  const entry = (summary.sources ?? []).find((s) => s.name === label)
  const failed = (summary.checks ?? []).filter((c) => c.ok === false && String(c.name).startsWith(label))
  if (!entry) return { status: 'NIEPEŁNY', reasons: [`źródło ${label} nie występuje w sources`], present: false }
  const reasons = []
  let status = 'OK'
  if (entry.status !== 'OK') {
    status = 'NIEPEŁNY'
    reasons.push(`${label}: BRAK_DANYCH${entry.reason ? ` — ${entry.reason}` : ''}`)
  }
  if (failed.length > 0) {
    status = 'UWAGA'
    for (const c of failed) reasons.push(`kontrola nie przeszła: ${c.name} (różnica ${c.diff})`)
  }
  if (summary.closed === false && status === 'OK') {
    status = 'NIEPEŁNY'
    reasons.push('miesiąc niezamknięty (dane do dnia generacji)')
  }
  return { status, reasons, present: entry.status === 'OK' }
}

function flowsView(f) {
  const cur = f.currency
  const out = {
    currency: cur,
    payments: f.paymentsCount,
    gross: money(f.gross, cur),
    refunds: money(f.refunds, cur),
    disputes: money(f.disputes, cur),
    fees: f.fees === null ? 'brak w pliku (prowizje z faktury operatora)' : money(f.fees, cur),
    otherFees: money(f.otherFees, cur),
    ...(f.climate ? { stripeClimate: money(f.climate, cur) } : {}),
    ...(f.other ? { otherOperations: money(f.other, cur) } : {}),
    ...(f.outgoing ? { outgoingPayments: money(f.outgoing, cur) } : {}),
    ...(f.topUps ? { topUps: money(f.topUps, cur) } : {}),
    net: money(f.net, cur),
    netNote: f.fees === null ? 'netto bez prowizji (prowizje nie są w pliku)' : undefined,
    payouts: `${money(f.payoutsSum, cur)} (${f.payoutsCount} ${f.payoutsCount === 1 ? 'wypłata' : 'wypłat'})`,
    refundsPctOfGross: pct(f.refunds, f.gross) ?? 'brak (brutto 0)',
    feesPctOfGross: f.fees === null ? null : pct(f.fees, f.gross) ?? 'brak (brutto 0)',
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
  if (!previous) return { comparable: false, reason: `brak pliku ${summaryPath(previousMonth(month))} (poprzedni miesiąc nie jest opublikowany)` }
  if (summary.closed === false) return { comparable: false, vs: previous.month, reason: `${month} jest niezamknięty — nie porównuję z pełnym miesiącem` }
  if (previous.closed === false) return { comparable: false, vs: previous.month, reason: `${previous.month} jest niezamknięty` }
  const a = rawOf(summary, key)
  const b = rawOf(previous, key)
  const sa = sourceMeta(summary, key)
  const sb = sourceMeta(previous, key)
  if (!a || !b || sa.status === 'NIEPEŁNY' || sb.status === 'NIEPEŁNY') {
    return { comparable: false, vs: previous.month, reason: `brak pełnych danych ${SOURCE_LABEL[key]} w jednym z miesięcy (${month}: ${sa.status}, ${previous.month}: ${sb.status})` }
  }
  const line = (cur, prev, currency) => `${money(prev, currency)} → ${money(cur, currency)} (${signedMoney(cur - prev, currency)}, ${pct(cur - prev, Math.abs(prev), true) ?? 'brak bazy'})`
  const out = {
    comparable: true,
    vs: previous.month,
    gross: line(a.gross, b.gross, a.currency),
    refunds: line(a.refunds, b.refunds, a.currency),
    net: line(a.net, b.net, a.currency),
    payments: `${b.paymentsCount} → ${a.paymentsCount}`,
  }
  if (a.fees !== null && b.fees !== null) {
    out.fees = line(a.fees, b.fees, a.currency)
    const ra = tenths(a.fees, a.gross)
    const rb = tenths(b.fees, b.gross)
    if (ra !== null && rb !== null) out.feesPctOfGross = `${pct(b.fees, b.gross)} → ${pct(a.fees, a.gross)}`
  } else {
    out.fees = 'brak prowizji w pliku (jeden z miesięcy) — nie porównuję'
  }
  return out
}

function anomaliesFor(month, summary, previous, key, meta) {
  const label = SOURCE_LABEL[key]
  const out = []
  if (meta.status === 'UWAGA') out.push(`${month} ${label}: status UWAGA — ${meta.reasons.join('; ')}`)
  const a = rawOf(summary, key)
  if (a && meta.present) {
    const refundRate = tenths(a.refunds, a.gross)
    if (a.refunds > 0 && refundRate !== null && refundRate >= 20) out.push(`${month} ${label}: zwroty ${money(a.refunds, a.currency)} = ${pct(a.refunds, a.gross)} brutto (próg uwagi 2,0%)`)
    if (a.disputes > 0) out.push(`${month} ${label}: spory/blokady ${money(a.disputes, a.currency)}`)
    if (summary.closed !== false && previous && previous.closed !== false) {
      const b = rawOf(previous, key)
      if (b && a.fees !== null && b.fees !== null) {
        const ra = tenths(a.fees, a.gross)
        const rb = tenths(b.fees, b.gross)
        if (ra !== null && rb !== null && ra - rb >= 3) out.push(`${month} ${label}: wzrost prowizji w brutto ${pct(b.fees, b.gross)} → ${pct(a.fees, a.gross)} (próg uwagi +0,3 pp)`)
      }
      if (b && b.gross > 0) {
        const change = tenths(a.gross - b.gross, b.gross)
        if (change !== null && Math.abs(change) >= 300) out.push(`${month} ${label}: brutto zmieniło się o ${pct(a.gross - b.gross, b.gross, true)} względem ${previous.month}`)
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
      source: 'PAYPAL (obciążenia za reklamy Meta)',
      status: paypal.status,
      ...(paypal.reasons.length ? { reasons: paypal.reasons } : {}),
      ...(paypal.present
        ? {
            list: charges.map((c) => `${c.date}  ${money(c.amount, c.currency)}`),
            sum: chargeSums.map((s) => `${money(s.amount, s.currency)} (${s.count} ${s.count === 1 ? 'płatność' : 'płatności'})`),
          }
        : {}),
    },
    rule: 'TO TEN SAM KOSZT W DWÓCH UJĘCIACH (Insights = wydatek wg panelu Meta, PayPal = faktyczne obciążenia). Pokazuj osobno, NIGDY nie sumuj i nie dodawaj. Insights nie jest kwotą obciążenia (progi rozliczeniowe, terminy); dokumentem kosztowym jest rachunek Meta.',
  }
  // Change vs previous month, per view (not summed together).
  if (summary.closed !== false && previous && previous.closed !== false && insights.present && sourceMeta(previous, 'meta').present) {
    const cur = (summary.meta?.insightsSpendByScope ?? []).filter((s) => s.currency === 'PLN').reduce((n, s) => n + s.spend, 0)
    const prev = (previous.meta?.insightsSpendByScope ?? []).filter((s) => s.currency === 'PLN').reduce((n, s) => n + s.spend, 0)
    view.insights.changeVsPrevious = `${previous.month}: ${money(prev)} → ${money(cur)} (${signedMoney(cur - prev, 'PLN')}, ${pct(cur - prev, Math.abs(prev), true) ?? 'brak bazy'})`
  } else {
    view.insights.changeVsPrevious = summary.closed === false ? 'nie porównuję: miesiąc niezamknięty' : 'brak pełnych danych poprzedniego miesiąca'
  }
  return view
}

function openNote(summary) {
  const note = (summary.notes ?? []).find((n) => String(n).startsWith('MIESIĄC NIEZAMKNIĘTY'))
  return note ?? 'MIESIĄC NIEZAMKNIĘTY'
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
    ...(index ? {} : { missing: [`${BUCKET}/index.json — nie mam tych danych: brak publikacji`] }),
    months: [],
    limits: LIMITS,
    notPublished: `koszty z banku, subskrypcje, opłaty bankowe: ${NOT_PUBLISHED_ANSWER}`,
    statusRule: 'OK = źródło OK, kontrole ✔, miesiąc zamknięty; NIEPEŁNY = źródło BRAK_DANYCH albo miesiąc niezamknięty; UWAGA = kontrola nie przeszła.',
  }
  for (const month of months) {
    const summary = summaries.get(month)
    if (!summary) {
      result.months.push({
        month,
        available: false,
        missing: `${BUCKET}/${summaryPath(month)} — nie mam tych danych: miesiąc nie jest opublikowany`,
      })
      continue
    }
    if (summary.schemaVersion !== SCHEMA_VERSION) {
      result.months.push({ month, available: false, missing: `${summaryPath(month)}: nieobsługiwana wersja schematu (${summary.schemaVersion})` })
      continue
    }
    const previous = summaries.get(previousMonth(month)) ?? null
    const view = {
      month,
      available: true,
      closed: summary.closed,
      generatedAt: summary.generatedAt,
      ...(summary.closed === false
        ? { warning: `${openNote(summary)}. Nie porównywać z pełnym miesiącem; to dane częściowe.` }
        : {}),
      sources: {},
      anomalies: [],
      missing: [],
    }
    for (const key of keys) {
      if (key === 'meta') {
        const meta = metaView(month, summary, previous)
        view.sources.meta = meta
        view.anomalies.push(...(meta.status === 'UWAGA' ? [`${month} META: status UWAGA`] : []))
        for (const part of [meta.insights, meta.paypalCharges]) {
          if (part.status === 'NIEPEŁNY' && part.reasons?.length && !('byScope' in part) && !('list' in part)) {
            view.missing.push(`${summaryPath(month)} → ${part.source}: nie mam tych danych (${part.reasons.join('; ')})`)
          }
        }
        continue
      }
      const meta = sourceMeta(summary, key)
      const section = key === 'paypal' ? summary.paypal : summary[key]
      const entry = { source: SOURCE_LABEL[key], month, status: meta.status, ...(meta.reasons.length ? { statusReasons: meta.reasons } : {}) }
      if (!meta.present || !section) {
        entry.data = null
        view.missing.push(`${summaryPath(month)} → ${key} (${SOURCE_LABEL[key]}): nie mam tych danych${meta.reasons.length ? ` — ${meta.reasons.join('; ')}` : ''}`)
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
  if (invalid.length > 0) throw new RequestError(`nieprawidłowy miesiąc: ${invalid.join(', ')} (oczekiwany format RRRR-MM)`)
  const unique = [...new Set(trimmed)].sort()
  if (unique.length > MAX_MONTHS) throw new RequestError(`najwyżej ${MAX_MONTHS} miesięcy naraz`)
  const src = source ? String(source).trim().toLowerCase() : undefined
  if (src && !SOURCE_KEYS.includes(src)) throw new RequestError(`nieznane źródło: ${src} (dozwolone: ${SOURCE_KEYS.join(', ')})`)
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
// model dropped statuses and the "nie mam tych danych" file names. Stanley's text is a comment
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

const pad = (s, n) => String(s).padEnd(n)
const feesCell = (d) => (String(d.fees).startsWith('brak') ? 'brak w pliku' : d.fees)

function tableRows(m) {
  const rows = []
  const label = `${m.month}${m.closed === false ? '*' : ''}`
  const push = (name, status, d) => rows.push([label, name, status, d.gross, d.refunds, feesCell(d), d.net])
  for (const key of ['stripe', 'p24', 'paypal']) {
    const s = m.sources[key]
    if (!s) continue
    if (s.data) {
      push(s.source, s.status, s.data)
      for (const other of s.otherCurrencies ?? []) push(`${s.source} ${other.currency}`, s.status, other)
    } else if (s.byCurrency) {
      for (const d of s.byCurrency) push(d.currency === 'PLN' ? s.source : `${s.source} ${d.currency}`, s.status, d)
    } else {
      rows.push([label, s.source, s.status, '—', '—', '—', '—'])
    }
  }
  return rows
}

export function renderReport(view) {
  const L = []
  const open = view.months.filter((m) => m.available && m.closed === false)
  const rows = view.months.flatMap((m) => (m.available ? tableRows(m) : []))
  if (rows.length > 0) {
    const head = ['Miesiąc', 'Źródło', 'Status', 'Brutto', 'Zwroty', 'Prowizje', 'Netto']
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)))
    const line = (r) => r.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()
    L.push('SUMY (wpływy od operatorów płatności, nie sprzedaż z Wix)', line(head), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line))
    for (const m of view.months.filter((x) => x.available)) {
      const payouts = ['stripe', 'p24', 'paypal'].flatMap((key) => {
        const s = m.sources[key]
        if (!s) return []
        const ds = s.data ? [s.data, ...(s.otherCurrencies ?? [])] : (s.byCurrency ?? [])
        return ds.filter((d) => !d.payouts.startsWith('0,00')).map((d) => `${s.source}${d.currency === 'PLN' ? '' : ` ${d.currency}`}: ${d.payouts}`)
      })
      if (payouts.length > 0) L.push('', `Wypłaty na rachunek ${m.month}: ${payouts.join('; ')}`)
      for (const key of ['stripe', 'p24']) {
        const s = m.sources[key]
        if (s?.data && String(s.data.fees).startsWith('brak')) {
          L.push(`${s.source} ${m.month}: prowizje nie są w pliku (rozlicza je faktura operatora), więc netto = brutto − zwroty, bez prowizji.`)
        }
      }
      const pp = m.sources.paypal?.byCurrency?.find((d) => d.currency === 'PLN')
      if (pp && (pp.outgoingPayments || pp.topUps)) {
        L.push(`PAYPAL ${m.month}: netto uwzględnia też płatności wychodzące (${pp.outgoingPayments ?? '0,00 zł'}) i zasilenia salda (${pp.topUps ?? '0,00 zł'}).`)
      }
    }
  }
  for (const m of view.months.filter((x) => x.available && x.sources.meta)) {
    const { insights, paypalCharges } = m.sources.meta
    L.push('', `META ${m.month}${m.closed === false ? '*' : ''} — status ${m.sources.meta.status} (dwa ujęcia TEGO SAMEGO kosztu — nie sumować)`)
    L.push(`  wydatki wg Insights (panel Meta) [${insights.status}]: ${insights.total ? Object.values(insights.total).join(' / ') : `nie mam tych danych: ${(insights.reasons ?? []).join('; ') || 'brak'}`}`)
    L.push(`  obciążenia przez PayPal [${paypalCharges.status}]: ${paypalCharges.sum ? paypalCharges.sum.join(' / ') : `nie mam tych danych: ${(paypalCharges.reasons ?? []).join('; ') || 'brak'}`}`)
  }
  if (open.length > 0) {
    L.push('', ...open.map((m) => `* ${m.warning}`))
  }

  const changes = view.months.filter((m) => m.available).flatMap((m) =>
    ['stripe', 'p24', 'paypal'].flatMap((key) => {
      const c = m.sources[key]?.changeVsPrevious
      if (!c) return []
      const name = `${m.month} ${m.sources[key].source}`
      return c.comparable
        ? [`${name} vs ${c.vs}: brutto ${c.gross}; zwroty ${c.refunds}; prowizje ${c.fees}${c.feesPctOfGross ? ` (udział w brutto ${c.feesPctOfGross})` : ''}; netto ${c.net}`]
        : [`${name}: brak porównania — ${c.reason}`]
    }),
  )
  const metaChanges = view.months.filter((m) => m.available && m.sources.meta).map((m) => `${m.month} META Insights: ${m.sources.meta.insights.changeVsPrevious}`)
  L.push('', 'ZMIANA WZGLĘDEM POPRZEDNIEGO MIESIĄCA', ...(changes.length + metaChanges.length ? [...changes, ...metaChanges].map((x) => `  ${x}`) : ['  brak danych do porównania']))

  const anomalies = view.months.filter((m) => m.available).flatMap((m) => m.anomalies)
  L.push('', 'ANOMALIE (progi: zwroty ≥ 2,0% brutto, wzrost prowizji ≥ 0,3 pp, zmiana brutto ≥ 30%, status UWAGA)',
    ...(anomalies.length ? anomalies.map((a) => `  ! ${a}`) : ['  nie wykryto anomalii']))

  const missing = [...(view.missing ?? []), ...view.months.flatMap((m) => (m.available ? m.missing : [m.missing]))]
  L.push('', 'BRAKI DANYCH', ...(missing.length ? missing.map((x) => `  ${x}`) : ['  brak w żądanym zakresie']))
  L.push('', 'Wix pozostaje prawdą transakcyjną dla zamówień i przychodu; powyższe to wpływy od operatorów płatności.')
  return L.join('\n')
}
