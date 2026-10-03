#!/usr/bin/env node
// Runs the alarm rules against the real orders table and prints what they say.
//
// Unit tests prove the rules do what they say on invented days. This proves the
// days are right: it rebuilds the daily series from `orders` through the same
// business-day helper the app uses, prints it next to the Wix CSV reference,
// and then evaluates the rules on it.
//
//   npm run alerts                      # the last 14 full days + today
//   npm run alerts -- 2026-09-20        # from a given day
//
// Reads through the deployed profit-data endpoint, because `orders` is
// RLS-closed to the anon key and no DDL or service credential is available
// here. The classification and the day boundary are the production ones.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  businessDay, businessToday, businessDaysAgo, businessDaysBetween,
} from '../netlify/shared/businessDay.js'
import {
  ALERT_RULES, countsAsOrder, evaluateAlerts, todayContext,
} from '../netlify/shared/alertRules.js'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root
const SITE = process.env.STANLEY_SITE_URL ?? 'https://elegant-kelpie-6fdfc8.netlify.app'

const envFile = join(rootDir, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

/** What the Wix CSV says, for the days the task pinned. Paid, > 5 PLN, Warsaw day. */
const WIX_REFERENCE = {
  '2026-09-20': 16, '2026-09-21': 7,  '2026-09-22': 10, '2026-09-23': 9,
  '2026-09-24': 12, '2026-09-25': 12, '2026-09-26': 22, '2026-09-27': 11,
  '2026-09-28': 15, '2026-09-29': 15, '2026-09-30': 14, '2026-10-01': 12,
  '2026-10-02': 9,
}
const REFERENCE_ROLLING_7 = { on: '2026-10-02', expected: 98 }
/** The CSV counts by payment date, `orders` by creation date — one day of drift. */
const TOLERANCE = 1

let failures = 0
const fail = (m) => { console.error('  FAIL', m); failures++ }
const pass = (m) => console.log('  pass', m)

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json()
}

// ── build the series the way orders-data builds it ──────────────────────────

async function loadSeries(from, to) {
  const d = await getJson(`${SITE}/.netlify/functions/profit-data?from=${from}&to=${to}&debug=1`)
  if (!d.ok) throw new Error(`profit-data: ${d.error}`)

  const rows = d.debugOrders ?? []
  const hourly = new Map()
  const anyRow = new Set()
  for (const r of rows) {
    const ts = r.order_created_at
    const date = ts ? businessDay(ts) : r.order_date
    if (!date) continue
    anyRow.add(date)
    if (!countsAsOrder(r.amount)) continue
    if (!hourly.has(date)) hourly.set(date, { hours: new Array(24).fill(0), revenue: 0 })
    const h = ts
      ? Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false })
          .format(new Date(ts))) % 24
      : 0
    const e = hourly.get(date)
    e.hours[h]++
    e.revenue += Number(r.amount) || 0
  }

  const today = businessToday()
  const series = businessDaysBetween(from, businessDaysAgo(1, to >= today ? today : to)).map(date => {
    const e = hourly.get(date)
    return {
      date,
      orders: e ? e.hours.reduce((s, n) => s + n, 0) : 0,
      revenue: e?.revenue ?? 0,
      missing: !anyRow.has(date),
      hourly: e?.hours ?? new Array(24).fill(0),
    }
  })
  const t = hourly.get(today)
  return {
    recordStartsOn: [...anyRow].sort()[0] ?? null,
    series,
    today: { date: today, orders: t ? t.hours.reduce((s, n) => s + n, 0) : 0, hourly: t?.hours ?? new Array(24).fill(0) },
    droppedTestOrders: rows.length - rows.filter(r => countsAsOrder(r.amount)).length,
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const today = businessToday()
const from = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])
  ? process.argv[2]
  : businessDaysAgo(14, today)

console.log(`alarmy — dane na żywo · ${SITE} · doba Europe/Warsaw · dziś ${today}`)
console.log(`zakres: ${from} → ${today}  (próg zamówienia > ${ALERT_RULES.ORDER_MIN_AMOUNT_PLN} zł)\n`)

// A long enough history for the 7-day window and the 120-day comparison.
const { series, today: todayRow, droppedTestOrders, recordStartsOn } =
  await loadSeries(businessDaysAgo(ALERT_RULES.TODAY_PERCENTILE_WINDOW_DAYS + 10, today), today)

console.log(`odrzucone zamówienia ≤ ${ALERT_RULES.ORDER_MIN_AMOUNT_PLN} zł (testowe): ${droppedTestOrders}\n`)

// ── the daily table, against the Wix CSV ────────────────────────────────────
console.log('  data        | orders | CSV Wix | delta | kroczące 7')
console.log('  ' + '-'.repeat(58))
const byDate = new Map(series.map(d => [d.date, d]))
for (const date of businessDaysBetween(from, businessDaysAgo(1, today))) {
  const d = byDate.get(date)
  if (!d) continue
  const idx = series.findIndex(x => x.date === date)
  const w = series.slice(Math.max(0, idx - 6), idx + 1)
  const roll = w.length === 7 ? w.reduce((s, x) => s + x.orders, 0) : null
  const ref = WIX_REFERENCE[date]
  const delta = ref == null ? null : d.orders - ref
  const mark = delta == null ? '' : Math.abs(delta) <= TOLERANCE ? '' : '  <-- POZA TOLERANCJĄ'
  console.log(
    `  ${date} | ${String(d.orders).padStart(6)} | ${(ref ?? '—').toString().padStart(7)} `
    + `| ${(delta == null ? '—' : (delta >= 0 ? '+' : '') + delta).padStart(5)} `
    + `| ${(roll ?? '—').toString().padStart(10)}${d.missing ? '  [BRAK WIERSZY]' : ''}${mark}`)
}
console.log('  ' + '-'.repeat(58))

const outOfTolerance = Object.entries(WIX_REFERENCE)
  .filter(([date, ref]) => byDate.has(date) && Math.abs(byDate.get(date).orders - ref) > TOLERANCE)
if (outOfTolerance.length === 0) {
  pass(`każda doba z referencji mieści się w ±${TOLERANCE}`)
} else {
  fail(`poza tolerancją: ${outOfTolerance.map(([d, r]) => `${d} (orders ${byDate.get(d).orders} vs CSV ${r})`).join(', ')}`)
}

const refIdx = series.findIndex(d => d.date === REFERENCE_ROLLING_7.on)
if (refIdx >= 6) {
  const got = series.slice(refIdx - 6, refIdx + 1).reduce((s, d) => s + d.orders, 0)
  const delta = got - REFERENCE_ROLLING_7.expected
  if (Math.abs(delta) <= TOLERANCE) pass(`kroczące 7 na ${REFERENCE_ROLLING_7.on} = ${got} (referencja ${REFERENCE_ROLLING_7.expected})`)
  else fail(`kroczące 7 na ${REFERENCE_ROLLING_7.on} = ${got}, referencja ${REFERENCE_ROLLING_7.expected}`)
}

// ── the rules, on those days ────────────────────────────────────────────────
const perf = await getJson(
  `${SITE}/.netlify/functions/profit-data?from=${businessDaysAgo(7, today)}&to=${businessDaysAgo(1, today)}`)
const last7 = series.slice(-7)
const orders7 = last7.reduce((s, d) => s + d.orders, 0)
const revenue7 = last7.reduce((s, d) => s + d.revenue, 0)
const spend7 = perf?.ok ? perf.adSpend : null
const cpa7 = spend7 != null && orders7 > 0 ? spend7 / orders7 : null
const roas7 = spend7 != null && spend7 > 0 ? revenue7 / spend7 : null

const campaign = await getJson(
  `${SITE}/.netlify/functions/campaign-data?from=${last7[0].date}&to=${last7[last7.length - 1].date}`)
    .catch(() => ({ rows: [] }))

const verdict = evaluateAlerts({
  series,
  cpa: cpa7, cpaRolling7: cpa7,
  roas: roas7, roasRolling7: roas7,
  fullDays: 7,
  adDays: campaign.rows ?? [],
  recordStartsOn,
})

console.log('\n=== STAN ALARMÓW ===')
console.log(`  okno 7 pełnych dób: ${last7[0].date} → ${last7[last7.length - 1].date}`)
console.log(`  zamówienia = ${orders7} · przychód = ${revenue7.toFixed(2)} zł · ad spend = ${spend7 == null ? 'BRAK' : spend7.toFixed(2) + ' zł'}`)
console.log(`  CPA = ${cpa7 == null ? 'BRAK' : cpa7.toFixed(2) + ' zł'} · ROAS = ${roas7 == null ? 'BRAK' : roas7.toFixed(2) + 'x'}\n`)
for (const a of verdict.all) {
  const tag = a.severity === 'red' ? 'CZERWONY' : a.severity === 'amber' ? 'ŻÓŁTY   ' : '—       '
  console.log(`  [${tag}] ${a.rule.padEnd(16)} ${a.message}`)
}

const nowHour = Number(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', hour: '2-digit', hour12: false }).format(new Date())) % 24
const ctx = todayContext(
  todayRow.hourly.slice(0, nowHour + 1).reduce((s, n) => s + n, 0), nowHour, series)
console.log(`\n  DZIŚ (informacyjnie): ${ctx.note}`)

// The in-progress day must not be able to raise anything.
const dailyVerdict = verdict.all.find(a => a.rule === 'DOBOWY')
if (!series.some(d => d.date === today)) pass('dzisiejsza, niepełna doba nie jest w serii alarmowej')
else fail('dzisiejsza doba trafiła do serii alarmowej — niepełny dzień mógłby odpalić alarm')
console.log(`  alarm DOBOWY: ${dailyVerdict.severity === 'red' ? 'CZERWONY' : 'brak'}`)

console.log('')
if (failures > 0) {
  console.error(`FAIL — ${failures} niezgodności.`)
  process.exit(1)
}
console.log('PASS — seria dobowa zgadza się z referencją, alarmy policzone z pełnych dób.')
