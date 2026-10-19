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
import { businessDay, businessWallClock } from '../netlify/shared/businessDay.js'
import { classifyAmount, PRODUCTS } from '../netlify/shared/productCatalog.js'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

// ── arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const flagValue = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback
}
const flagNames = ['--base', '--json', '--tolerance']
const csvPath = args.find((a, i) => !a.startsWith('--') && !flagNames.includes(args[i - 1]))
const BASE = flagValue('--base', 'https://elegant-kelpie-6fdfc8.netlify.app')
const JSON_OUT = flagValue('--json', null)
const TOL = Number(flagValue('--tolerance', '300')) * 1000
/** Below this the dashboard does not treat an order as a real sale. */
const ORDER_FLOOR = 5

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
head('KROK 5 — PAROWANIE (kwota dokładna, czas ±5 min, jeden do jednego)')

const expByAmount = groupBy(expected, p => key(p.amount))
const actByAmount = groupBy(actual, o => key(o.amount))

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

// ── 6. what the leftovers actually are ───────────────────────────────────────
head('KROK 6 — CO NAPRAWDĘ ZOSTAŁO PO PAROWANIU')

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

// A leftover Supabase row sitting next to a row that DID pair, at the same
// amount, is not an extra sale — it is the same sale written twice. Calling it
// "surplus" would hide a duplicate, which inflates every count on the
// dashboard, so it gets its own name.
const matchedSup = pairs.map(p => p.sup).sort((a, b) => a.ms - b.ms)
const duplicates = []
const freeOrders = []
let trueSurplus = []
for (const s of surplus) {
  const twin = matchedSup.find(m => key(m.amount) === key(s.amount) && Math.abs(m.ms - s.ms) <= TOL)
  if (twin) duplicates.push({ copy: s, original: twin, deltaS: (s.ms - twin.ms) / 1000 })
  else if (Number(s.amount) === 0) freeOrders.push(s)
  else trueSurplus.push(s)
}

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
console.log(`   ├─ duplikaty               ${String(duplicates.length).padStart(5)}   ta sama sprzedaż zapisana dwa razy`)
console.log(`   ├─ zamówienia za 0 zł      ${String(freeOrders.length).padStart(5)}   darmowe — w eksporcie PŁATNOŚCI nie mogą wystąpić`)
console.log(`   └─ zwrócone                ${String(refundPairs.length).padStart(5)}   pieniądze przeszły i wróciły — Supabase ma je słusznie`)
console.log(`?  NIEROZSTRZYGNIĘTE          ${String(unresolved.length).padStart(5)}   para w czasie, rozjazd kwoty`)
console.log('')
const sumExpected = pairs.length + lost.length + unresolved.length
const sumActual = pairs.length + trueSurplus.length + duplicates.length
  + freeOrders.length + refundPairs.length + unresolved.length
console.log(`kontrola: A + B + ? = ${sumExpected} = oczekiwane ${expected.length} → ${sumExpected === expected.length ? 'OK' : 'NIE ZGADZA SIĘ'}`)
console.log(`kontrola: A + C + dupl + 0 zł + zwroty + ? = ${sumActual} = faktyczne ${actual.length} → ${sumActual === actual.length ? 'OK' : 'NIE ZGADZA SIĘ'}`)

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
console.log(`par: ${duplicates.length}. Każda to jedna sprzedaż policzona dwa razy — zawyża`)
console.log('liczbę zamówień, przychód i marżę na pulpicie za te dni.')
if (duplicates.length > 0) {
  const byDay = groupBy(duplicates, d => businessDay(d.copy.order_created_at))
  console.log('')
  console.log('  dzień        par   zawyżenie przychodu')
  for (const [day, rows] of [...byDay].sort()) {
    console.log(`  ${day}  ${String(rows.length).padStart(5)}   ${fmt(rows.reduce((s, r) => s + Number(r.copy.amount), 0)).padStart(12)} zł`)
  }
  console.log('')
  console.log(`  zawyżenie łącznie: ${duplicates.length} zamówień · ${fmt(duplicates.reduce((s, r) => s + Number(r.copy.amount), 0))} zł`)
  console.log('')
  console.log('  przykłady (oryginał / kopia, odstęp w order_created_at):')
  for (const d of duplicates.slice(0, 6)) {
    console.log(`    ${businessWallClock(d.copy.order_created_at)}  ${fmt(d.copy.amount).padStart(9)} zł  ${d.copy.email_masked.padEnd(26)} Δ${d.deltaS.toFixed(2)} s`)
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
