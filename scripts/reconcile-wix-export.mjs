#!/usr/bin/env node
// Reconcile a full Wix payments export against Supabase: what the shop took,
// versus what the dashboard can see.
//
//   node scripts/reconcile-wix-export.mjs "payments (17).csv"
//   node scripts/reconcile-wix-export.mjs export.csv --json out.json
//
// ONE-OFF TOOL. Nothing in the dashboard imports it, nothing schedules it, and
// it writes NOTHING to Supabase — it is read-only by construction, because it
// holds no write credential at all. Running it twice changes nothing.
//
// WHY IT READS SUPABASE THROUGH THE DEPLOYED FUNCTION
// ---------------------------------------------------------------------------
// `orders` is closed to the anon key by RLS, and closed quietly: the REST call
// returns HTTP 200 with `[]`, so a script reading it directly would report
// every order as lost and look confident doing it. The service-role key lives
// only in Netlify. So the one path that can see `orders` is the deployed
// profit-data function, and that is the path used here.
//
// That is not a workaround, it is the right comparison. profit-data applies
// isCountableOrder() and aggregateOrders() from productCatalog.js, so what it
// returns is exactly the set of orders the dashboard counts. The question is
// "what did the dashboard never get to see", and this answers it against the
// dashboard's own view, with no second copy of the classification logic here.
//
// HOW ROWS ARE PAIRED
// ---------------------------------------------------------------------------
// Supabase has no Wix order number yet (20261019_wix_order_number.sql is still
// unapplied) and `external_order_id` is a UUID the export does not carry, so
// the only shared key is (when, how much).
//
// Rows pair on an EXACT amount and a timestamp within ±5 minutes, one to one,
// never one to many. Within an amount the pairing is a maximum matching over
// sorted times, so a burst of six identical 119 PLN orders pairs six for six
// wherever that is possible — the conservative direction, because it minimises
// what this tool is willing to call a loss.
//
// A hard rule from manual verification, which this tool obeys:
//
//     A WINDOW IN BACKLOG IS NOT A WINDOW WITH A LOSS.
//
// On 2026-10-17 the 11:00–11:23 window was flagged as backlogged and all five
// orders (16022–16026) arrived. The only rows lost that day were three 1 PLN
// payments at 20:20–20:21. Nothing below is inferred from a backlog flag;
// every loss reported here is a row of the export with no counterpart.

import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { build } from 'esbuild'
import { readWixPaymentsExport } from './_wixExport.mjs'
import { renderDedupSql, renderDedupTrace } from './_dedupSql.mjs'
import { businessDay, businessWallClock } from '../netlify/shared/businessDay.js'
import { classifyAmount, PRODUCTS } from '../netlify/shared/productCatalog.js'
import { ALERT_RULES, dailyLowAlert, rolling7Alert } from '../netlify/shared/alertRules.js'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

// ── arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback
}
const flagNames = ['--base', '--json', '--tolerance', '--emit-dedup']
const csvPath = args.find((a, i) => !a.startsWith('--') && !flagNames.includes(args[i - 1]))
const BASE = flagValue('--base', 'https://elegant-kelpie-6fdfc8.netlify.app')
const JSON_OUT = flagValue('--json', null)
const TOL = Number(flagValue('--tolerance', '300')) * 1000
/** Repo root to write the de-duplication SQL and its paper trail into. */
const EMIT_DEDUP = flagValue('--emit-dedup', null)
/** Below this the dashboard does not treat an order as a real sale. */
const ORDER_FLOOR = 5

/**
 * How close two rows must be in time to be the same order written twice.
 *
 * NOT the ±5 minute pairing tolerance. At 5 minutes this test is useless: 119
 * PLN sold 1 421 times in the window, so two genuinely different customers
 * five minutes apart look like a duplicate, and an earlier run of this script
 * "found" three such pairs — one of which was two distinct UUID rows with
 * different e-mail addresses.
 *
 * Measured instead. A hand-pasted row carries the order's own timestamp
 * rounded to the whole second, so a true copy sits within a second of its
 * twin. Across all 84 pasted rows, the distance to the nearest row with the
 * same amount AND the same e-mail falls into:
 *
 *     ≤ 1 s   60 rows      ← copies
 *     ≤ 2 s    7 rows      ← copies, rounding crossed a second
 *     ≤ 1 h    0 rows      ← nothing lives here
 *     > 1 h   10 rows      ← the same customer buying again
 *     (and 7 rows have no same-amount, same-e-mail row at all)
 *
 * 2 seconds sits in the middle of an empty hour. It is not a tuned threshold;
 * anything from 2 s to ~1 h gives the same 67 pairs.
 */
const DUP_WINDOW_MS = 2000

if (!csvPath || !existsSync(csvPath)) {
  console.error('usage: node scripts/reconcile-wix-export.mjs <wix-payments-export.csv> [--base URL] [--json OUT]')
  if (csvPath) console.error(`  nie ma pliku: ${csvPath}`)
  process.exit(1)
}

const fmt = (n) => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (a, b) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`)
const key = (a) => Number(a).toFixed(2)
const hr = (c = '─') => console.log(c.repeat(94))
const head = (t) => { console.log(''); hr('='); console.log(t); hr('=') }
const groupBy = (list, fn) => {
  const m = new Map()
  for (const x of list) {
    const k = fn(x)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(x)
  }
  return m
}
const tally = (list, fn) => {
  const m = new Map()
  for (const x of list) m.set(fn(x), (m.get(fn(x)) ?? 0) + 1)
  return m
}

// ── 1. the export ────────────────────────────────────────────────────────────
head('KROK 1 — EKSPORT WIX')
const xp = readWixPaymentsExport(csvPath)
console.log(`plik:              ${csvPath}`)
console.log(`nagłówek w wierszu ${xp.headerRow}, strefa z nagłówka GMT ${xp.offsetMinutes >= 0 ? '+' : '-'}${String(Math.abs(xp.offsetMinutes) / 60).padStart(2, '0')}:00`)
console.log(`wierszy danych:    ${xp.payments.length}`)
console.log(`nieparsowalnych:   ${xp.unparsable.length}`)
for (const u of xp.unparsable.slice(0, 10)) console.log(`    POMINIĘTE linia ${u.line}: data=${u.date} kwota=${u.amount}`)
if (xp.unparsable.length > 10) console.log(`    … i ${xp.unparsable.length - 10} więcej`)
const allTimes = xp.payments.map(p => p.paidAtMs)
console.log(`zakres eksportu:   ${new Date(Math.min(...allTimes)).toISOString()}  →  ${new Date(Math.max(...allTimes)).toISOString()}`)
console.log('rozkład statusów:')
for (const [s, n] of [...tally(xp.payments, p => p.statusRaw)].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(22)} ${String(n).padStart(6)}`)
}

// ── 2. Supabase ──────────────────────────────────────────────────────────────
head('KROK 2 — SUPABASE (przez wdrożoną funkcję profit-data, tylko odczyt)')

/**
 * Every order the dashboard can see, month by month.
 *
 * Chunked so no single invocation carries five months of debug rows, and
 * de-duplicated on order_id because fetchOrdersInRange widens each month by a
 * day on either side.
 */
async function fetchSupabaseOrders(fromMonth, toMonth) {
  const byId = new Map()
  const months = []
  let cur = fromMonth
  for (let guard = 0; guard < 240; guard++) {
    months.push(cur)
    if (cur === toMonth) break
    const [y, m] = cur.split('-').map(Number)
    cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  }
  for (const month of months) {
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const url = `${BASE}/.netlify/functions/profit-data`
      + `?from=${month}-01&to=${month}-${String(lastDay).padStart(2, '0')}&debug=1`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`profit-data ${month}: HTTP ${res.status}`)
    const body = await res.json()
    if (!body.ok) throw new Error(`profit-data ${month}: ${body.error ?? 'nie ok'}`)
    if (!Array.isArray(body.debugOrders)) {
      throw new Error(`profit-data ${month}: brak debugOrders — czy wdrożona wersja obsługuje debug=1?`)
    }
    for (const o of body.debugOrders) byId.set(o.order_id, o)
    console.log(`  ${month}: ${body.debugOrders.length} zamówień`)
  }
  return [...byId.values()]
}

const supabaseOrders = await fetchSupabaseOrders('2026-06', new Date().toISOString().slice(0, 7))
for (const o of supabaseOrders) o.ms = Date.parse(o.order_created_at)
const dated = supabaseOrders.filter(o => Number.isFinite(o.ms))
console.log(`razem:             ${supabaseOrders.length} zamówień (${supabaseOrders.length - dated.length} bez order_created_at)`)
const supTimes = dated.map(o => o.ms)
console.log(`zakres Supabase:   ${new Date(Math.min(...supTimes)).toISOString()}  →  ${new Date(Math.max(...supTimes)).toISOString()}`)

// ── 3. the window both sides cover ───────────────────────────────────────────
head('KROK 3 — OKNO UZGODNIENIA')
const WINDOW_FROM = Math.min(...supTimes)   // first row the table ever held
const WINDOW_TO   = Math.max(...allTimes)   // moment the export was taken
const inWindow = (ms) => ms >= WINDOW_FROM && ms <= WINDOW_TO

console.log('Uzgadniam wyłącznie część wspólną. Poza nią nie ma czego z czym zestawiać,')
console.log('więc nic tam nie liczę i niczego nie estymuję.')
console.log(`  od: ${new Date(WINDOW_FROM).toISOString()}  (${businessWallClock(new Date(WINDOW_FROM).toISOString())} PL) — pierwszy wiersz w tabeli orders`)
console.log(`  do: ${new Date(WINDOW_TO).toISOString()}  (${businessWallClock(new Date(WINDOW_TO).toISOString())} PL) — ostatnia płatność w eksporcie`)
console.log('')
console.log(`poza oknem, NIE liczone jako strata:  ${xp.payments.filter(p => p.settled && p.paidAtMs < WINDOW_FROM).length} zrealizowanych płatności sprzed startu tabeli`)
console.log(`poza oknem, NIE liczone jako nadmiar: ${dated.filter(o => o.ms > WINDOW_TO).length} zamówień w Supabase po dacie eksportu`)

// ── 4. the two sides ─────────────────────────────────────────────────────────
head('KROK 4 — DWIE STRONY DO ZESTAWIENIA')

// isCountableOrder() drops rows whose e-mail contains "test". Mirror it here,
// or a test order would look exactly like a lost one.
const windowPayments = xp.payments.filter(p => inWindow(p.paidAtMs))
const testEmails = windowPayments.filter(p => p.settled && /test/i.test(p.email))
const reversed   = windowPayments.filter(p => p.reversed)
const declined   = windowPayments.filter(p => !p.settled && !p.reversed)
const expected   = windowPayments.filter(p => p.settled && !/test/i.test(p.email))
const actual     = dated.filter(o => inWindow(o.ms))

console.log(`eksport w oknie:          ${windowPayments.length}`)
console.log(`  − odrzucone:            ${String(declined.length).padStart(4)}   (pieniądze nie przeszły — Supabase nie powinien ich mieć)`)
console.log(`  − zwroty / chargeback:  ${String(reversed.length).padStart(4)}   (pieniądze przeszły i wróciły — rozliczam osobno)`)
console.log(`  − e-mail z "test":      ${String(testEmails.length).padStart(4)}   (odfiltrowane też przez isCountableOrder)`)
console.log(`  = OCZEKIWANE:           ${String(expected.length).padStart(4)}`)
console.log(`FAKTYCZNE w Supabase:     ${String(actual.length).padStart(4)}`)
console.log(`różnica:                  ${String(actual.length - expected.length).padStart(4)}`)
console.log('')
console.log('KANAŁ SPRZEDAŻY (kolumna "Rodzaj zamówienia") — to okaże się kluczowe:')
for (const [k, n] of [...tally(expected, p => p.orderKind || '(puste)')].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${String(n).padStart(5)}`)
}

// ── 5. pairing ───────────────────────────────────────────────────────────────
head('KROK 5 — DUPLIKATY, ZANIM COKOLWIEK SPARUJĘ')

/** The same order written twice — see DUP_WINDOW_MS for why the key is this tight. */
const sameOrder = (a, b) => key(a.amount) === key(b.amount)
  && a.email_masked === b.email_masked
  && Math.abs(a.ms - b.ms) <= DUP_WINDOW_MS

const PASTED_ID = /^wix-(\d+)$/
const isPasted = (o) => PASTED_ID.test(String(o.order_id))

// Duplicates are found BEFORE the payments are paired, not after.
//
// After does not work, and the way it fails is instructive. The payment
// matcher pairs on amount and time and knows nothing about e-mail, so in a
// burst of same-price orders it is arbitrary which row ends up without a
// payment. Run that way, six of the August copies came out as "surplus in
// Supabase" — an extra sale nobody was paid for — purely because the matcher
// had handed their payment to the other copy. Removing the copies first makes
// the question well posed: one row per order on each side, then compare.
const duplicates = []
for (const [, rows] of groupBy(actual, o => `${key(o.amount)}|${o.email_masked}`)) {
  if (rows.length < 2) continue
  rows.sort((a, b) => a.ms - b.ms)
  for (let i = 0; i < rows.length;) {
    let j = i + 1
    while (j < rows.length && rows[j].ms - rows[j - 1].ms <= DUP_WINDOW_MS) j++
    const cluster = rows.slice(i, j)
    if (cluster.length > 1) {
      // The UUID row stays: it carries Wix's own id and a sub-second
      // timestamp, where the paste rounded to the whole second.
      const keep = cluster.find(o => !isPasted(o)) ?? cluster[0]
      for (const c of cluster) {
        if (c !== keep) duplicates.push({ copy: c, original: keep, deltaS: (c.ms - keep.ms) / 1000 })
      }
    }
    i = j
  }
}

const copyIds = new Set(duplicates.map(d => d.copy.order_id))
const deduped = actual.filter(o => !copyIds.has(o.order_id))

console.log(`zamówień w Supabase w oknie:        ${String(actual.length).padStart(5)}`)
console.log(`− kopii tego samego zamówienia:     ${String(duplicates.length).padStart(5)}`)
console.log(`= wierszy do zestawienia:           ${String(deduped.length).padStart(5)}`)
console.log('')
console.log('Szczegóły duplikatów i gotowy SQL — w kroku 10.')

// ── 6. pairing ───────────────────────────────────────────────────────────────
head('KROK 6 — PAROWANIE (kwota dokładna, czas ±5 min, jeden do jednego)')

const expByAmount = groupBy(expected, p => key(p.amount))
const actByAmount = groupBy(deduped, o => key(o.amount))

const pairs = []
let lost = []
let surplus = []

for (const [amount, exps] of expByAmount) {
  const acts = (actByAmount.get(amount) ?? []).slice().sort((a, b) => a.ms - b.ms)
  const taken = new Array(acts.length).fill(false)
  let j = 0
  for (const e of exps.slice().sort((a, b) => a.paidAtMs - b.paidAtMs)) {
    // Anything before e − TOL can never match e, nor anything after it.
    while (j < acts.length && acts[j].ms < e.paidAtMs - TOL) j++
    if (j < acts.length && acts[j].ms <= e.paidAtMs + TOL) {
      pairs.push({ csv: e, sup: acts[j], deltaS: (acts[j].ms - e.paidAtMs) / 1000 })
      taken[j] = true
      j++
    } else lost.push(e)
  }
  acts.forEach((a, i) => { if (!taken[i]) surplus.push(a) })
}
for (const [amount, acts] of actByAmount) if (!expByAmount.has(amount)) surplus.push(...acts)

const deltas = pairs.map(p => p.deltaS).sort((a, b) => a - b)
console.log(`dopasowanych par: ${pairs.length}`)
console.log('')
console.log('ROZJAZD CZASU W PARACH (Supabase − Wix):')
console.log(`  mediana ${deltas[Math.floor(deltas.length / 2)].toFixed(1)} s`
  + ` · p95 ${deltas[Math.floor(deltas.length * 0.95)].toFixed(1)} s`
  + ` · min ${deltas[0].toFixed(1)} s · max ${deltas[deltas.length - 1].toFixed(1)} s`)
console.log('  To jest dowód, że strefa z nagłówka (GMT +02:00) jest poprawna. Gdyby była')
console.log('  przesunięta choćby o godzinę, mediana leżałaby przy ±3600 s, nie przy zeru.')

// ── 6b. what is left over ────────────────────────────────────────────────────
head('KROK 6b — CO ZOSTAŁO PO PAROWANIU')

// A refunded payment was taken before it was given back, so the order really
// existed and Supabase is right to hold it. Those rows were kept out of
// `expected` (they are not a sale any more) and would otherwise be counted as
// surplus — which would be calling the sync wrong for being right.
const refundPairs = []
{
  const used = new Set()
  for (const r of reversed) {
    const hit = surplus.find(s => !used.has(s.order_id)
      && key(s.amount) === key(r.amount) && Math.abs(s.ms - r.paidAtMs) <= TOL)
    if (hit) { used.add(hit.order_id); refundPairs.push({ csv: r, sup: hit }) }
  }
  surplus = surplus.filter(s => !used.has(s.order_id))
}

const freeOrders = surplus.filter(s => Number(s.amount) === 0)
let trueSurplus = surplus.filter(s => Number(s.amount) !== 0)

// A lost row with an unmatched Supabase row inside the tolerance but at a
// different amount is neither a loss nor a surplus — it is a question, and it
// is reported as one instead of being decided here.
const unresolved = []
{
  const used = new Set()
  const stillLost = []
  for (const e of lost.sort((a, b) => a.paidAtMs - b.paidAtMs)) {
    const near = trueSurplus.find(s => !used.has(s.order_id) && Math.abs(s.ms - e.paidAtMs) <= TOL)
    if (near) { used.add(near.order_id); unresolved.push({ csv: e, sup: near, deltaS: (near.ms - e.paidAtMs) / 1000 }) }
    else stillLost.push(e)
  }
  lost = stillLost
  trueSurplus = trueSurplus.filter(s => !used.has(s.order_id))
}

console.log(`A  DOPASOWANE                 ${String(pairs.length).padStart(5)}`)
console.log(`B  ZGUBIONE                   ${String(lost.length).padStart(5)}   w eksporcie, nie ma w Supabase`)
console.log(`C  NADMIAROWE                 ${String(trueSurplus.length).padStart(5)}   w Supabase, nie ma w eksporcie`)
console.log(`   ├─ zamówienia za 0 zł      ${String(freeOrders.length).padStart(5)}   darmowe — w eksporcie PŁATNOŚCI nie mogą wystąpić`)
console.log(`   └─ zwrócone                ${String(refundPairs.length).padStart(5)}   pieniądze przeszły i wróciły — Supabase ma je słusznie`)
console.log(`?  NIEROZSTRZYGNIĘTE          ${String(unresolved.length).padStart(5)}   para w czasie, rozjazd kwoty`)
console.log(`   duplikaty (odjęte w kroku 5) ${String(duplicates.length).padStart(3)}`)
console.log('')
const sumExpected = pairs.length + lost.length + unresolved.length
const sumActual = pairs.length + trueSurplus.length + freeOrders.length
  + refundPairs.length + unresolved.length + duplicates.length
console.log(`kontrola: A + B + ? = ${sumExpected} = oczekiwane ${expected.length} → ${sumExpected === expected.length ? 'OK' : 'NIE ZGADZA SIĘ'}`)
console.log(`kontrola: A + C + 0 zł + zwroty + ? + duplikaty = ${sumActual} = faktyczne ${actual.length} → ${sumActual === actual.length ? 'OK' : 'NIE ZGADZA SIĘ'}`)

// ── 7. bucket B ──────────────────────────────────────────────────────────────
head('KROK 7 — BUCKET B: CO NAPRAWDĘ PRZEPADŁO')

const lostRevenue = lost.reduce((s, p) => s + p.amount, 0)
const lostAbove = lost.filter(p => p.amount >= ORDER_FLOOR)
const lostBelow = lost.filter(p => p.amount < ORDER_FLOOR)

console.log(`zgubionych:        ${lost.length} z ${expected.length} oczekiwanych  (${pct(lost.length, expected.length)})`)
console.log(`utracony przychód: ${fmt(lostRevenue)} zł`)
console.log(`  ≥ ${ORDER_FLOOR} zł (liczone jako sprzedaż): ${lostAbove.length} szt · ${fmt(lostAbove.reduce((s, p) => s + p.amount, 0))} zł`)
console.log(`  < ${ORDER_FLOOR} zł (poniżej progu):        ${lostBelow.length} szt · ${fmt(lostBelow.reduce((s, p) => s + p.amount, 0))} zł`)
console.log('')
console.log('PEŁNA LISTA:')
console.log('  data i godzina (PL)      kwota  nr zam.   kanał           operator     produkt')
hr()
for (const p of lost.slice().sort((a, b) => a.paidAtMs - b.paidAtMs)) {
  const cls = classifyAmount(p.amount, p.name)
  const prod = cls.productKey ? PRODUCTS[cls.productKey].shortName : `(${p.name.slice(0, 22) || 'bez nazwy'})`
  const num = /^\d+$/.test(String(p.orderNumber)) ? p.orderNumber : '—'
  console.log(`  ${businessWallClock(p.paidAt)}  ${fmt(p.amount).padStart(9)}  ${String(num).padEnd(8)} ${(p.orderKind || '—').padEnd(15)} ${p.operator.padEnd(12)} ${prod}`)
}
hr()

// ── 8. where the losses sit ──────────────────────────────────────────────────
head('KROK 8 — ROZKŁAD STRAT')

console.log('KANAŁ SPRZEDAŻY — to jest cała odpowiedź, reszta przekrojów jest jej echem:')
const kinds = [...new Set(expected.map(p => p.orderKind || '(puste)'))]
for (const k of kinds) {
  const e = expected.filter(p => (p.orderKind || '(puste)') === k)
  const l = lost.filter(p => (p.orderKind || '(puste)') === k)
  console.log(`  ${k.padEnd(18)} zgubione ${String(l.length).padStart(4)} / ${String(e.length).padStart(5)}`
    + `  ${pct(l.length, e.length).padStart(7)}  ·  ${fmt(l.reduce((s, p) => s + p.amount, 0)).padStart(10)} zł`)
}

const DOW = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
const dowOf = (iso) => new Date(`${businessDay(iso)}T12:00:00Z`).getUTCDay()
const hourOf = (iso) => Number(businessWallClock(iso).slice(11, 13))
const crossTab = (label, fn, keys, fmtKey) => {
  console.log('')
  console.log(`${label} — zgubione / oczekiwane:`)
  const e = tally(expected, fn), l = tally(lost, fn)
  for (const k of keys) {
    const en = e.get(k) ?? 0, ln = l.get(k) ?? 0
    if (en === 0 && ln === 0) continue
    console.log(`  ${fmtKey(k).padEnd(14)} ${String(ln).padStart(4)} / ${String(en).padStart(5)}  ${pct(ln, en).padStart(7)}`)
  }
}
crossTab('GODZINA (czas polski)', p => hourOf(p.paidAt), [...Array(24).keys()], h => `${String(h).padStart(2, '0')}:00`)
crossTab('DZIEŃ TYGODNIA', p => dowOf(p.paidAt), [1, 2, 3, 4, 5, 6, 0], d => DOW[d])
crossTab('OPERATOR', p => p.operator || '—', [...new Set(expected.map(p => p.operator || '—'))], x => x)
crossTab('KWOTA', p => key(p.amount), [...new Set(expected.map(p => key(p.amount)))].sort((a, b) => a - b), a => `${fmt(a)} zł`)

console.log('')
console.log('DZIEŃ PO DNIU — tylko dni, w których coś przepadło:')
const expByDay = groupBy(expected, p => businessDay(p.paidAt))
for (const [day, rows] of [...groupBy(lost, p => businessDay(p.paidAt))].sort()) {
  console.log(`  ${day}  ${String(rows.length).padStart(3)} / ${String(expByDay.get(day)?.length ?? 0).padStart(3)}`
    + `  ${fmt(rows.reduce((s, p) => s + p.amount, 0)).padStart(10)} zł`)
}

// ── 9. bursts ────────────────────────────────────────────────────────────────
head('KROK 9 — CZY STRATY SIEDZĄ W SERIACH')

const outDir = mkdtempSync(join(tmpdir(), 'stanley-reconcile-'))
const harness = join(outDir, 'orderWindow.mjs')
await build({
  entryPoints: [join(rootDir, 'src/lib/orderWindow.ts')],
  outfile: harness, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning',
})
let assessSyncHealth, SYNC_RUN_INTERVAL_MIN
try {
  ({ assessSyncHealth, SYNC_RUN_INTERVAL_MIN } = await import(pathToFileURL(harness).href))
} finally {
  rmSync(outDir, { recursive: true, force: true })
}

const windowKey = (ms) => {
  const d = new Date(ms)
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / SYNC_RUN_INTERVAL_MIN) * SYNC_RUN_INTERVAL_MIN, 0, 0)
  return d.toISOString()
}

// Measured on eCom only. A channel that is lost 100% of the time regardless of
// load would swamp the correlation and make a burst look guilty for something
// it had no part in.
const ecom = expected.filter(p => p.orderKind === 'eCom Platform')
const ecomLost = lost.filter(p => p.orderKind === 'eCom Platform')
const trueWindows = groupBy(ecom, p => windowKey(p.paidAtMs))
const lostWindows = groupBy(ecomLost, p => windowKey(p.paidAtMs))

console.log(`Mierzone na kanale eCom Platform (${ecom.length} zamówień, ${ecomLost.length} zgubionych).`)
console.log(`Okna ${SYNC_RUN_INTERVAL_MIN}-minutowe liczone z EKSPORTU, czyli ze wszystkiego, co się wydarzyło —`)
console.log('detektor w aplikacji widzi tylko to, co dotarło, i dlatego nie widzi prawdziwej serii.')
console.log('')
console.log('zamówień w oknie   okien   zamówień   zgubionych   udział strat')
for (const size of [...new Set([...trueWindows.values()].map(v => v.length))].sort((a, b) => a - b)) {
  const wins = [...trueWindows].filter(([, v]) => v.length === size)
  const orders = wins.length * size
  const lostHere = wins.reduce((s, [k]) => s + (lostWindows.get(k)?.length ?? 0), 0)
  console.log(`  ${String(size).padStart(2)}              ${String(wins.length).padStart(6)}  ${String(orders).padStart(9)}  ${String(lostHere).padStart(11)}  ${pct(lostHere, orders).padStart(13)}`)
}

const firstOfWindow = new Set([...trueWindows.values()].map(rows =>
  rows.slice().sort((a, b) => a.paidAtMs - b.paidAtMs)[0].line))
console.log('')
console.log(`zgubione, które były PIERWSZE w swoim oknie: ${ecomLost.filter(p => firstOfWindow.has(p.line)).length}`)
console.log(`zgubione, które były KOLEJNE w swoim oknie:  ${ecomLost.filter(p => !firstOfWindow.has(p.line)).length}`)

// ── 10. duplicates ───────────────────────────────────────────────────────────
head('KROK 10 — DUPLIKATY W SUPABASE')

// The August outage, reconstructed from the rows themselves.
//
// Make hit its operations limit and stood still for six days. The orders were
// pasted in by hand with `external_order_id` set to "wix-<Wix order number>".
// When the limit reset, the scenario went back and fetched some of the same
// orders again, this time with their real UUID — so those orders exist twice.
//
// WHICH COPY IS WHICH MATTERS, and not in the obvious direction. The UUID row
// is the authoritative one: it carries Wix's own id and a sub-second
// order_created_at, where the paste rounded to whole seconds. But the pasted
// row carries something the UUID row does not have anywhere — THE WIX ORDER
// NUMBER, sitting in its id. That is exactly the column
// 20261019_wix_order_number.sql is about to add. Deleting the pasted rows
// before reading those numbers off them throws away the only place in the
// database where they exist, so the generated SQL copies them across first.
const pastedNumber = (o) => Number(String(o.order_id).match(PASTED_ID)[1])

const allPasted = supabaseOrders.filter(isPasted)
const pastedBatches = [...tally(allPasted, o => o.inserted_at)].sort((a, b) => a[0].localeCompare(b[0]))

console.log(`par duplikatów: ${duplicates.length}`)
console.log(`wierszy z ręcznej wklejki ("wix-<numer>") w całej tabeli: ${allPasted.length}`)
console.log('')
console.log('wklejki wg inserted_at — kiedy ktoś je wprowadzał:')
for (const [at, n] of pastedBatches) console.log(`  ${at}  ${String(n).padStart(4)} wierszy`)

// ── 10.1 the pattern: exactly one pasted row and one UUID row per pair ──────
console.log('')
console.log('10.1  WZORZEC PARY — dokładnie jeden "wix-<numer>" i jeden UUID?')
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pairs67 = []
const brokenPattern = []
for (const d of duplicates) {
  const both = [d.copy, d.original]
  const pasted = both.filter(isPasted)
  const uuids = both.filter(o => UUID_ID.test(String(o.order_id)))
  if (pasted.length !== 1 || uuids.length !== 1) brokenPattern.push(d)
  else pairs67.push({ pasted: pasted[0], uuid: uuids[0] })
}
if (brokenPattern.length === 0) {
  console.log(`  PASS — wszystkie ${pairs67.length} pary mają jeden wiersz wklejony i jeden z UUID-em.`)
} else {
  console.log(`  STOP — ${brokenPattern.length} par łamie wzorzec. Nic nie kasuj, dopóki się nie wyjaśnią:`)
  for (const d of brokenPattern) {
    console.log(`    ${d.copy.order_id}  ${d.copy.order_created_at}  ${fmt(d.copy.amount)} zł`)
    console.log(`    ${d.original.order_id}  ${d.original.order_created_at}  ${fmt(d.original.amount)} zł`)
  }
}

// ── 10.2 pasted rows with no twin — the only copy there is ──────────────────
const pairedPastedIds = new Set(pairs67.map(x => x.pasted.order_id))
const soloPasted = allPasted.filter(o => !pairedPastedIds.has(o.order_id))
  .sort((a, b) => a.ms - b.ms)
console.log('')
console.log('10.2  WKLEJKI BEZ PARY — jedyna kopia tych zamówień, NIE WOLNO ICH KASOWAĆ')
if (soloPasted.length === 0) {
  console.log('  brak')
} else {
  console.log(`  ${soloPasted.length} wierszy. Sync nigdy nie pobrał ich ponownie, więc usunięcie`)
  console.log('  ich po wzorcu LIKE \'wix-%\' skasowałoby prawdziwą sprzedaż:')
  for (const o of soloPasted) {
    console.log(`    ${o.order_id.padEnd(12)} ${businessWallClock(o.order_created_at)}  ${fmt(o.amount).padStart(9)} zł  ${String(o.product_name_raw).replace(/\s+/g, ' ').slice(0, 44)}`)
  }
  console.log(`  razem ${fmt(soloPasted.reduce((s, o) => s + Number(o.amount), 0))} zł sprzedaży, która zniknęłaby bez śladu.`)
}

// ── 10.3 what the two rows of a pair actually differ in ─────────────────────
console.log('')
console.log('10.3  CZYM SIĘ RÓŻNIĄ OBA WIERSZE W PARZE')
const compared = ['amount', 'product_amount', 'shipping_amount', 'line_count',
  'email_masked', 'product_name_raw', 'bucket', 'product', 'matched_by']
const differing = new Map()
for (const { pasted, uuid } of pairs67) {
  for (const f of compared) {
    const a = String(pasted[f] ?? '').replace(/\s+/g, ' ').trim()
    const b = String(uuid[f] ?? '').replace(/\s+/g, ' ').trim()
    if (a !== b) differing.set(f, (differing.get(f) ?? 0) + 1)
  }
}
if (differing.size === 0) {
  console.log(`  Dane handlowe identyczne w każdej z ${pairs67.length} par:`)
  console.log(`  ${compared.join(', ')}.`)
} else {
  console.log('  UWAGA — pary różnią się polami, których nie powinny:')
  for (const [f, n] of differing) console.log(`    ${f}: ${n} par`)
}
const roundedOnly = pairs67.filter(x =>
  Math.abs(Date.parse(x.pasted.order_created_at) - Date.parse(x.uuid.order_created_at)) < 1000).length
console.log(`  order_created_at: wklejka zaokrąglona do pełnej sekundy w ${roundedOnly} z ${pairs67.length} par`)
console.log(`    (różnica < 1 s — ta sama chwila, mniejsza precyzja)`)
console.log('')
console.log('  CZEGO WKLEJKA MA WIĘCEJ: numer zamówienia Wix, wbity w external_order_id.')
console.log('  W wierszu z UUID-em nie ma go nigdzie. Dlatego wygenerowany SQL najpierw')
console.log('  przepisuje numer na wiersz z UUID-em, a dopiero potem kasuje wklejkę.')

// ── 10.4 the overstatement ──────────────────────────────────────────────────
console.log('')
console.log('10.4  O ILE ZAWYŻONY JEST PULPIT')
console.log('  dzień        par   zawyżenie przychodu')
for (const [day, rows] of [...groupBy(pairs67, x => businessDay(x.pasted.order_created_at))].sort()) {
  console.log(`  ${day}  ${String(rows.length).padStart(5)}   ${fmt(rows.reduce((s, r) => s + Number(r.pasted.amount), 0)).padStart(12)} zł`)
}
console.log(`  RAZEM        ${String(pairs67.length).padStart(5)}   ${fmt(pairs67.reduce((s, r) => s + Number(r.pasted.amount), 0)).padStart(12)} zł`)

// ── 10.5 the artefacts ──────────────────────────────────────────────────────
if (EMIT_DEDUP) {
  if (brokenPattern.length > 0) {
    console.log('')
    console.log('  SQL NIE ZOSTAŁ WYGENEROWANY — najpierw wyjaśnij pary łamiące wzorzec (10.1).')
  } else {
    const sqlPath = join(EMIT_DEDUP, 'supabase/migrations/20261020_dedup_august_duplicates.sql')
    const docPath = join(EMIT_DEDUP, 'docs/dedup_2026-08_duplicate_rows.md')
    const ordered = pairs67.slice().sort((a, b) => pastedNumber(a.pasted) - pastedNumber(b.pasted))
    const total = ordered.reduce((s, r) => s + Number(r.pasted.amount), 0)
    const generatedAt = new Date().toISOString().slice(0, 10)

    // What those days should read once the copies are gone — computed here so
    // the SQL can be checked against a number rather than against a feeling.
    const doomed = new Set(ordered.map(x => x.pasted.order_id))
    const expectedAfter = [...groupBy(
      actual.filter(o => !doomed.has(o.order_id)
        && businessDay(o.order_created_at) >= '2026-08-15'
        && businessDay(o.order_created_at) <= '2026-08-20'),
      o => businessDay(o.order_created_at))]
      .sort()
      .map(([day, rows]) => ({ day, orders: rows.length, revenue: rows.reduce((s, o) => s + Number(o.amount), 0) }))

    writeFileSync(sqlPath, renderDedupSql({ ordered, soloPasted, total, expectedAfter, generatedAt }), 'utf8')
    writeFileSync(docPath, renderDedupTrace({ ordered, soloPasted, pastedBatches, total, generatedAt }), 'utf8')
    console.log('')
    console.log(`  SQL:   ${sqlPath}`)
    console.log(`  ślad:  ${docPath}`)
  }
}

// ── 11. the detector, measured ───────────────────────────────────────────────
head('KROK 11 — KALIBRACJA DETEKTORA')

const health = assessSyncHealth(actual.map(o => o.order_created_at))
const flagged = new Set(health.backlogWindows.map(w => w.window))
const windowsWithLoss = new Set([...lostWindows.keys()])
let tp = 0, fp = 0, fn = 0
for (const w of flagged) (windowsWithLoss.has(w) ? tp++ : fp++)
for (const w of windowsWithLoss) if (!flagged.has(w)) fn++

console.log('A. DETEKTOR OBECNY — okno, w którym DOTARŁO więcej niż jedno zamówienie')
console.log(`  okien oznaczonych:                ${String(flagged.size).padStart(5)}`)
console.log(`  okien, w których coś przepadło:   ${String(windowsWithLoss.size).padStart(5)}`)
console.log(`  trafione:                         ${String(tp).padStart(5)}`)
console.log(`  fałszywe alarmy:                  ${String(fp).padStart(5)}`)
console.log(`  przeoczone:                       ${String(fn).padStart(5)}`)
console.log(`  precyzja ${pct(tp, tp + fp)} · czułość ${pct(tp, tp + fn)}`)
console.log('')
console.log('  Ten detektor nie da się wykalibrować. Liczy zamówienia, które DOTARŁY, a te')
console.log('  które przepadły, nie zostawiają po sobie śladu — więc okno z trzema stratami')
console.log('  i oknem z jednym zamówieniem wygląda z Supabase identycznie.')

// What the unapplied order-number column would buy, measured against the export
// rather than argued for.
const numeric = (p) => (/^\d+$/.test(String(p.orderNumber)) ? Number(p.orderNumber) : null)
const shouldHave = new Set(ecom.map(numeric).filter(n => n != null))
const lostNumbers = new Set(ecomLost.map(numeric).filter(n => n != null))
const arrivedNumbers = [...shouldHave].filter(n => !lostNumbers.has(n)).sort((a, b) => a - b)
const gaps = []
for (let i = 1; i < arrivedNumbers.length; i++) {
  for (let n = arrivedNumbers[i - 1] + 1; n < arrivedNumbers[i]; n++) gaps.push(n)
}
const gapTp = gaps.filter(n => lostNumbers.has(n)).length
const numbersInExport = new Set(windowPayments.map(numeric).filter(n => n != null))
const gapNoPayment = gaps.filter(n => !lostNumbers.has(n) && !numbersInExport.has(n)).length

console.log('')
console.log('B. DETEKTOR LUKI W NUMERACJI — zmierzony na tym eksporcie jako prawdzie')
console.log('   (kolumna orders.wix_order_number z 20261019_wix_order_number.sql, wciąż niewgranej)')
console.log(`  zgłoszonych brakujących numerów:  ${String(gaps.length).padStart(5)}`)
console.log(`  trafione:                         ${String(gapTp).padStart(5)} z ${lostNumbers.size} realnych strat`)
console.log(`  fałszywe alarmy:                  ${String(gaps.length - gapTp).padStart(5)}`)
console.log(`  precyzja ${pct(gapTp, gaps.length)} · czułość ${pct(gapTp, lostNumbers.size)}`)
console.log('')
console.log(`  Z ${gaps.length - gapTp} fałszywych alarmów ${gapNoPayment} to numery, pod którymi w eksporcie PŁATNOŚCI`)
console.log('  nie ma nic — czyli zamówienia za 0 zł. Supabase takie zamówienia trzyma')
console.log(`  (${freeOrders.length} w tym oknie), więc gdy Make zacznie zapisywać numer, te numery będą`)
console.log('  obecne i luki się zamkną. Podana precyzja jest więc dolnym oszacowaniem.')

// ── 11b. alert thresholds, recomputed without the phantom orders ────────────
head('KROK 11b — PROGI ALARMÓW NA SERII BEZ DUPLIKATÓW')

// ALERT_RULES was measured on 2026-10-03 against a 130-day series that still
// contained all 67 copies. Six August days were inflated by about eleven
// orders each, so any percentile taken over a window touching them was read
// off a series that overstated the business.
//
// The real rule functions are used below, not a reimplementation of them: the
// thresholds are swapped into ALERT_RULES, the alarm is evaluated, and the old
// values are put back. Counting alarms with a second copy of the logic would
// measure the copy.
const ordersData = await (await fetch(`${BASE}/.netlify/functions/orders-data`)).json()
const rawSeries = (ordersData.dailySeries ?? [])
  .filter(d => d.date < businessDay(new Date().toISOString()))
  .map(d => ({ date: d.date, orders: d.orders, missing: !!d.missing }))

// Only copies above the test-order floor change a count the alarms can see.
const countedCopies = duplicates.filter(d => Number(d.copy.amount) > ALERT_RULES.ORDER_MIN_AMOUNT_PLN)
const copiesPerDay = tally(countedCopies, d => businessDay(d.copy.order_created_at))
const cleanSeries = rawSeries.map(d => ({ ...d, orders: d.orders - (copiesPerDay.get(d.date) ?? 0) }))

console.log(`serii: ${rawSeries.length} pełnych dób, ${rawSeries[0]?.date} → ${rawSeries[rawSeries.length - 1]?.date}`)
console.log(`kopii powyżej progu ${ALERT_RULES.ORDER_MIN_AMOUNT_PLN} zł: ${countedCopies.length} z ${duplicates.length}`)
console.log('')
console.log('dni dotknięte:')
for (const [day, n] of [...copiesPerDay].sort()) {
  const raw = rawSeries.find(d => d.date === day)
  console.log(`  ${day}   było ${String(raw?.orders ?? '?').padStart(3)}   jest ${String((raw?.orders ?? 0) - n).padStart(3)}   (−${n})`)
}

/**
 * Percentile by nearest rank on the sorted sample.
 *
 * Stated rather than assumed: run against the uncleaned series this
 * reproduces the 72 / 65 that ALERT_RULES records, which is how we know the
 * comparison below is like for like and not two different definitions.
 */
const percentile = (values, p) => {
  const v = values.slice().sort((a, b) => a - b)
  if (v.length === 0) return null
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1))]
}
const rolling7 = (series) => {
  const out = []
  for (let i = 6; i < series.length; i++) {
    const w = series.slice(i - 6, i + 1)
    if (w.some(d => d.missing)) continue
    out.push(w.reduce((s, d) => s + d.orders, 0))
  }
  return out
}

const rawFull = rawSeries.filter(d => !d.missing).map(d => d.orders)
const cleanFull = cleanSeries.filter(d => !d.missing).map(d => d.orders)
const rawRoll = rolling7(rawSeries)
const cleanRoll = rolling7(cleanSeries)

/** Run a rule across the whole series with the given thresholds in force. */
function countAlarms(series, rule, overrides) {
  const target = ALERT_RULES[overrides.key]
  const saved = { ...target }
  Object.assign(target, overrides.values)
  let fired = 0
  try {
    for (let i = 1; i <= series.length; i++) {
      if (rule(series.slice(0, i)).severity !== 'none') fired++
    }
  } finally {
    Object.assign(target, saved)
  }
  return fired
}

const OLD_DAILY = { maxOrders: 5, consecutiveDays: 2 }
const OLD_ROLL = { amberBelow: 72, redBelow: 65 }
const newAmber = percentile(cleanRoll, 0.25)
const newRed = percentile(cleanRoll, 0.10)

// The series as it stood when ALERT_RULES was last measured. Comparing today
// against today cannot separate "the copies were removed" from "sixteen more
// days happened"; comparing the 2026-10-03 vintage with and without the copies
// isolates the first, and that is the question actually being asked.
const asOf = (series, lastDay) => series.filter(d => d.date <= lastDay)
const VINTAGE = '2026-10-02'
const rawVintage = asOf(rawSeries, VINTAGE)
const cleanVintage = asOf(cleanSeries, VINTAGE)

console.log('')
console.log('CZY TO DUPLIKATY PRZESUNĘŁY PROGI?')
console.log('  Seria z dnia wyliczenia progów (do ' + VINTAGE + '), z kopiami i bez.')
console.log('')
console.log('  miara                  z kopiami   bez kopii   różnica')
const cmp = (label, a, b) => console.log(`  ${label.padEnd(22)} ${String(a).padStart(9)} ${String(b).padStart(11)} ${String(b - a).padStart(9)}`)
const rawVrOll = rolling7(rawVintage), cleanVRoll = rolling7(cleanVintage)
cmp('okien kroczących', rawVrOll.length, cleanVRoll.length)
cmp('p25 krocząca 7', percentile(rawVrOll, 0.25), percentile(cleanVRoll, 0.25))
cmp('p10 krocząca 7', percentile(rawVrOll, 0.10), percentile(cleanVRoll, 0.10))
cmp('p10 dobowa', percentile(rawVintage.filter(d => !d.missing).map(d => d.orders), 0.10),
  percentile(cleanVintage.filter(d => !d.missing).map(d => d.orders), 0.10))
console.log('')
console.log(`  W ALERT_RULES zapisano p25 = ${OLD_ROLL.amberBelow}, p10 = ${OLD_ROLL.redBelow} na 108 oknach.`)
console.log('  Jeśli kolumna "z kopiami" to odtwarza, metoda liczenia się zgadza.')
console.log('')
console.log('  Duplikaty siedziały w GÓRZE rozkładu — 15-20.08 to były doby po 22-28')
console.log('  zamówień przy medianie 12. p10 i p25 czyta się z DOŁU rozkładu, a tam')
console.log('  tych okien nigdy nie było. Dlatego ich usunięcie nie rusza progów.')

console.log('')
console.log('ROZKŁAD DZIŚ — surowa seria vs bez duplikatów')
console.log('  miara                        surowa    czysta   różnica')
const line = (label, a, b) => console.log(`  ${label.padEnd(26)} ${String(a).padStart(6)} ${String(b).padStart(9)} ${String(b - a).padStart(9)}`)
line('mediana dobowa', percentile(rawFull, 0.5), percentile(cleanFull, 0.5))
line('p10 dobowa', percentile(rawFull, 0.10), percentile(cleanFull, 0.10))
line('p25 krocząca 7', percentile(rawRoll, 0.25), percentile(cleanRoll, 0.25))
line('p10 krocząca 7', percentile(rawRoll, 0.10), percentile(cleanRoll, 0.10))
line('okien kroczących', rawRoll.length, cleanRoll.length)

console.log('')
console.log('DOBOWY — ile dób ≤ N i ile par pod rząd, na czystej serii')
console.log('  N    dób ≤ N    par pod rząd')
for (const n of [4, 5, 6, 7, 8]) {
  const full = cleanSeries.filter(d => !d.missing)
  const days = full.filter(x => x.orders <= n).length
  let runs = 0
  for (let i = 1; i < full.length; i++) if (full[i].orders <= n && full[i - 1].orders <= n) runs++
  console.log(`  ${String(n).padStart(2)}  ${String(days).padStart(9)}  ${String(runs).padStart(13)}`)
}

console.log('')
console.log('PROGI — obecne vs na oczyszczonej serii z dziś')
console.log('  próg                         obecny    nowy   różnica')
console.log(`  DAILY_LOW.maxOrders          ${String(OLD_DAILY.maxOrders).padStart(6)} ${String(OLD_DAILY.maxOrders).padStart(7)} ${String(0).padStart(9)}`)
console.log(`  ROLLING_7.amberBelow (p25)   ${String(OLD_ROLL.amberBelow).padStart(6)} ${String(newAmber).padStart(7)} ${String(newAmber - OLD_ROLL.amberBelow).padStart(9)}`)
console.log(`  ROLLING_7.redBelow   (p10)   ${String(OLD_ROLL.redBelow).padStart(6)} ${String(newRed).padStart(7)} ${String(newRed - OLD_ROLL.redBelow).padStart(9)}`)
console.log('')
console.log('  Ta zmiana NIE pochodzi z deduplikacji — pochodzi z 16 dób, które')
console.log('  dołożyły się do serii od 03.10. Deduplikacja sama z siebie daje zero.')

console.log('')
console.log(`ILE ALARMÓW ODPALIŁOBY SIĘ NA ${cleanSeries.length} DOBACH (seria bez duplikatów)`)
console.log('  reguła        progi stare   progi nowe')
const dailyOld = countAlarms(cleanSeries, dailyLowAlert, { key: 'DAILY_LOW', values: OLD_DAILY })
const rollOld = countAlarms(cleanSeries, rolling7Alert, { key: 'ROLLING_7', values: OLD_ROLL })
const rollNew = countAlarms(cleanSeries, rolling7Alert, { key: 'ROLLING_7', values: { amberBelow: newAmber, redBelow: newRed } })
console.log(`  DOBOWY        ${String(dailyOld).padStart(11)}   ${String(dailyOld).padStart(10)}  (próg bez zmian)`)
console.log(`  KROCZĄCY_7    ${String(rollOld).padStart(11)}   ${String(rollNew).padStart(10)}`)
console.log('')
console.log(`  p25 z definicji zapala się na ćwiartce okien: ${rollNew} z ${cleanSeries.length} dób to ${pct(rollNew, cleanSeries.length)}.`)
console.log('  Jeśli to za często, zmienia się percentyl, nie dane.')

// ── 12. the required checks ──────────────────────────────────────────────────
head('KROK 12 — KONTROLE WYMAGANE W ZADANIU')
let failures = 0
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (detail) console.log(`        ${detail}`)
  if (!ok) failures++
}
const inDay = (list, day) => list.filter(p => businessDay(p.paidAt) === day)
const between = (list, from, to) => list.filter(p => businessWallClock(p.paidAt) >= from && businessWallClock(p.paidAt) <= to)

const lost1710 = inDay(lost, '2026-10-17')
check('17.10 — w buckecie B są dokładnie 3 pozycje po 1 zł',
  lost1710.length === 3 && lost1710.every(p => p.amount === 1),
  `${lost1710.length}: ${lost1710.map(p => `${businessWallClock(p.paidAt).slice(11)} ${fmt(p.amount)} zł nr ${p.orderNumber}`).join(', ') || 'nic'}`)
check('17.10 — nic powyżej 5 zł nie trafiło do bucketu B',
  lost1710.every(p => p.amount < ORDER_FLOOR),
  lost1710.filter(p => p.amount >= ORDER_FLOOR).map(p => `${businessWallClock(p.paidAt)} ${fmt(p.amount)} zł`).join(', ')
    || 'brak takich — zgodnie z weryfikacją ręczną')

const win1710 = between(inDay(expected, '2026-10-17'), '2026-10-17 11:00', '2026-10-17 11:23:59')
check('17.10 11:00–11:23 — okno oznaczone jako zaległe, ale BEZ strat',
  win1710.length === 5 && win1710.every(p => !lost.includes(p)),
  `${win1710.length} zamówień (nr ${win1710.map(p => p.orderNumber).sort().join(', ')}), zgubionych ${win1710.filter(p => lost.includes(p)).length}`)

const win0610 = between(inDay(expected, '2026-10-06'), '2026-10-06 21:46', '2026-10-06 21:57:59')
check('06.10 21:46–21:57 — 3 × 119 zł, numery 15875–15877',
  win0610.length === 3 && win0610.every(p => p.amount === 119)
    && win0610.map(p => p.orderNumber).sort().join(',') === '15875,15876,15877',
  win0610.map(p => `nr ${p.orderNumber} ${fmt(p.amount)} zł ${businessWallClock(p.paidAt).slice(11)}`).join(' | '))
check('06.10 21:46–21:57 — wszystkie trzy dotarły do Supabase',
  win0610.every(p => !lost.includes(p)),
  `dotarło ${win0610.filter(p => !lost.includes(p)).length} z ${win0610.length}`)

// ── 13. bucket C, unresolved, reversals ──────────────────────────────────────
head('KROK 13 — BUCKET C, NIEROZSTRZYGNIĘTE, ZWROTY')
console.log(`C — nadmiarowe, po odjęciu duplikatów i zamówień za 0 zł: ${trueSurplus.length}`)
for (const o of trueSurplus.slice().sort((a, b) => a.ms - b.ms)) {
  console.log(`  ${businessWallClock(o.order_created_at)}  ${fmt(o.amount).padStart(9)} zł  ${o.email_masked.padEnd(26)} ${String(o.product_name_raw).replace(/\s+/g, ' ').slice(0, 44)}`)
}
console.log('')
console.log(`zamówienia za 0 zł w Supabase (nie mogą mieć wiersza w eksporcie płatności): ${freeOrders.length}`)
console.log('')
console.log(`? — nierozstrzygnięte: ${unresolved.length}`)
for (const u of unresolved) {
  console.log(`  ${businessWallClock(u.csv.paidAt)}  Wix ${fmt(u.csv.amount)} zł (nr ${u.csv.orderNumber ?? '—'})`
    + `  vs  Supabase ${fmt(u.sup.amount)} zł  Δ${u.deltaS.toFixed(0)} s`)
}
console.log('')
console.log(`zwroty / chargeback w oknie: ${reversed.length}`)
for (const p of reversed.slice().sort((a, b) => a.paidAtMs - b.paidAtMs)) {
  const here = refundPairs.some(r => r.csv === p)
  console.log(`  ${businessWallClock(p.paidAt)}  ${fmt(p.amount).padStart(9)} zł  ${p.statusRaw.padEnd(20)} w Supabase: ${here ? 'tak' : 'NIE'}`)
}

// ── 14. the bottom line ──────────────────────────────────────────────────────
head('PODSUMOWANIE')
console.log(`okno:                ${businessWallClock(new Date(WINDOW_FROM).toISOString())} → ${businessWallClock(new Date(WINDOW_TO).toISOString())} (czas polski)`)
console.log(`oczekiwane z Wix:    ${expected.length}`)
console.log(`A dopasowane:        ${pairs.length}  (${pct(pairs.length, expected.length)})`)
console.log(`B zgubione:          ${lost.length}  (${pct(lost.length, expected.length)})  ·  ${fmt(lostRevenue)} zł`)
for (const k of kinds) {
  const l = lost.filter(p => (p.orderKind || '(puste)') === k)
  const e = expected.filter(p => (p.orderKind || '(puste)') === k)
  console.log(`   ${k.padEnd(16)} ${String(l.length).padStart(4)} / ${String(e.length).padStart(5)}  ${pct(l.length, e.length).padStart(7)}  ·  ${fmt(l.reduce((s, p) => s + p.amount, 0)).padStart(9)} zł`)
}
console.log(`   z tego ≥ ${ORDER_FLOOR} zł:     ${lostAbove.length}  ·  ${fmt(lostAbove.reduce((s, p) => s + p.amount, 0))} zł`)
console.log(`C nadmiarowe:        ${trueSurplus.length}`)
console.log(`  duplikaty:         ${duplicates.length}  ·  zawyżenie ${fmt(duplicates.reduce((s, r) => s + Number(r.copy.amount), 0))} zł`)
console.log(`  zamówienia 0 zł:   ${freeOrders.length}`)
console.log(`  zwrócone:          ${refundPairs.length}`)
console.log(`? nierozstrzygnięte: ${unresolved.length}`)
console.log('')
console.log(`kontroli nieudanych: ${failures}`)

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    window: { from: new Date(WINDOW_FROM).toISOString(), to: new Date(WINDOW_TO).toISOString() },
    counts: {
      expected: expected.length, matched: pairs.length, lost: lost.length,
      surplus: trueSurplus.length, duplicates: duplicates.length,
      freeOrders: freeOrders.length, refunded: refundPairs.length,
      unresolved: unresolved.length,
    },
    lost: lost.map(p => ({
      paidAt: p.paidAt, warsaw: businessWallClock(p.paidAt), amount: p.amount,
      orderNumber: p.orderNumber, orderKind: p.orderKind, operator: p.operator, name: p.name,
    })),
    duplicates: duplicates.map(d => ({ at: d.copy.order_created_at, amount: d.copy.amount, deltaS: d.deltaS })),
    surplus: trueSurplus.map(o => ({ at: o.order_created_at, amount: o.amount, product: o.product_name_raw })),
    unresolved: unresolved.map(u => ({
      wix: { at: u.csv.paidAt, amount: u.csv.amount, orderNumber: u.csv.orderNumber },
      supabase: { at: u.sup.order_created_at, amount: u.sup.amount }, deltaS: u.deltaS,
    })),
    detectors: {
      window: { flagged: flagged.size, truePositives: tp, falsePositives: fp, missed: fn },
      numberGap: { flagged: gaps.length, truePositives: gapTp, falsePositives: gaps.length - gapTp },
    },
  }, null, 2), 'utf8')
  console.log(`\nJSON: ${JSON_OUT}`)
}

process.exit(failures > 0 ? 1 : 0)
