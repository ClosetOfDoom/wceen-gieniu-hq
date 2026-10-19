#!/usr/bin/env node
// Backfill orders the Wix→Supabase sync never delivered, from a CSV export.
//
// The sync writes one row per 15-minute run, so a burst of orders loses
// everything past the first — see assessSyncHealth in src/lib/orderWindow.ts
// for the measurement. This puts the missing rows back.
//
//   node scripts/backfill-order-numbers.mjs zamowienia.csv            # dry run
//   node scripts/backfill-order-numbers.mjs zamowienia.csv --apply    # write
//
// RULES IT WILL NOT BREAK
//   · It only INSERTS. An order already in Supabase is never updated, never
//     overwritten, never touched — the live row stays authoritative.
//   · Running it twice changes nothing the second time.
//   · A CSV row it cannot parse into a date, an amount and an id is reported
//     and skipped, never guessed at.
//   · Writing needs SUPABASE_SERVICE_ROLE_KEY. With only the anon key it runs
//     the comparison and prints what WOULD be inserted.
//
// The CSV is the Wix payments export. Column names are matched case- and
// accent-insensitively, so both the Polish and English exports work.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { businessDay } from '../netlify/shared/businessDay.js'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

// ── env ──────────────────────────────────────────────────────────────────────
const envFile = join(rootDir, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const SUPA_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const WRITE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const READ_KEY = WRITE_KEY ?? process.env.VITE_SUPABASE_ANON_KEY

const file = process.argv[2]
const apply = process.argv.includes('--apply')

if (!file) {
  console.error('usage: node scripts/backfill-order-numbers.mjs <wix-export.csv> [--apply]')
  process.exit(1)
}
if (!existsSync(file)) {
  console.error(`FAIL — nie ma pliku: ${file}`)
  process.exit(1)
}
if (!SUPA_URL || !READ_KEY) {
  console.error('FAIL — brak SUPABASE_URL / klucza (sprawdzono env i .env)')
  process.exit(1)
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** A CSV parser that survives quoted fields containing commas and newlines. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',' || c === ';') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(x => x.trim() !== ''))
}

const norm = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim()

/** Find a column by any of several header spellings. */
function columnIndex(header, ...candidates) {
  const h = header.map(norm)
  for (const c of candidates) {
    const i = h.findIndex(x => x === norm(c) || x.includes(norm(c)))
    if (i >= 0) return i
  }
  return -1
}

const raw = readFileSync(file, 'utf8')
const rows = parseCsv(raw)
if (rows.length < 2) {
  console.error('FAIL — CSV nie ma wierszy danych')
  process.exit(1)
}
const header = rows[0]
const iNumber = columnIndex(header, 'nr zamowienia', 'order number', 'numer zamowienia')
const iDate   = columnIndex(header, 'data', 'date', 'data zamowienia', 'order date')
const iAmount = columnIndex(header, 'kwota', 'total', 'amount', 'suma')
const iEmail  = columnIndex(header, 'email', 'e-mail', 'kontakt')
const iName   = columnIndex(header, 'produkt', 'product', 'pozycje', 'items')
const iStatus = columnIndex(header, 'status platnosci', 'payment status', 'status')

const missingCols = []
if (iNumber < 0) missingCols.push('Nr zamówienia')
if (iDate < 0) missingCols.push('Data')
if (iAmount < 0) missingCols.push('Kwota')
if (missingCols.length > 0) {
  console.error(`FAIL — w CSV brakuje kolumn: ${missingCols.join(', ')}`)
  console.error(`  nagłówek pliku: ${header.join(' | ')}`)
  process.exit(1)
}

const toNumber = (s) => {
  const n = Number(String(s ?? '').replace(/[^\d,.-]/g, '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const parsed = []
const unparsable = []
for (const r of rows.slice(1)) {
  const number = parseInt(String(r[iNumber] ?? '').replace(/\D/g, ''), 10)
  const amount = toNumber(r[iAmount])
  const dateRaw = String(r[iDate] ?? '').trim()
  const when = Date.parse(dateRaw)
  if (!Number.isFinite(number) || amount == null || Number.isNaN(when)) {
    unparsable.push({ number: r[iNumber], date: dateRaw, amount: r[iAmount] })
    continue
  }
  parsed.push({
    wix_order_number: number,
    order_created_at: new Date(when).toISOString(),
    businessDay: businessDay(new Date(when).toISOString()),
    amount,
    email: iEmail >= 0 ? String(r[iEmail] ?? '').trim() : '',
    product_name_raw: iName >= 0 ? String(r[iName] ?? '').trim() : '',
    status: iStatus >= 0 ? String(r[iStatus] ?? '').trim() : '',
  })
}

console.log(`CSV: ${parsed.length} wierszy sparsowanych, ${unparsable.length} pominiętych`)
if (unparsable.length > 0) {
  console.log('  POMINIĘTE (nie zgaduję — popraw w pliku i uruchom ponownie):')
  for (const u of unparsable.slice(0, 10)) {
    console.log(`    nr=${u.number} data=${u.date} kwota=${u.amount}`)
  }
}

// ── what Supabase already holds ──────────────────────────────────────────────

async function pg(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: READ_KEY, Authorization: `Bearer ${init.write ? WRITE_KEY : READ_KEY}`,
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

let existing
try {
  // Paged and ordered, like every other read in this repo.
  existing = []
  for (let offset = 0; ; offset += 1000) {
    const page = await pg(
      `orders?select=wix_order_number,external_order_id,order_created_at,amount`
      + `&order=order_created_at.desc&limit=1000&offset=${offset}`)
    existing.push(...page)
    if (page.length < 1000) break
  }
} catch (e) {
  console.error(`FAIL — nie mogę odczytać orders: ${String(e?.message ?? e)}`)
  console.error('  klucz anon jest zablokowany przez RLS; potrzebny SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const haveNumbers = new Set(existing.map(r => r.wix_order_number).filter(n => n != null))
const coverage = haveNumbers.size

console.log(`Supabase: ${existing.length} wierszy, ${coverage} z numerem zamówienia`)
if (coverage === 0) {
  console.log('')
  console.log('  UWAGA: orders.wix_order_number jest puste w całej tabeli.')
  console.log('  Bez numerów nie rozpoznam, które wiersze z CSV już są w bazie, więc')
  console.log('  nie wstawię niczego — wstawianie "na oko" zrobiłoby duplikaty.')
  console.log('  Kolejność: 1) wgraj 20261019_wix_order_number.sql,')
  console.log('             2) zmapuj numer w scenariuszu Make,')
  console.log('             3) uruchom ten skrypt ponownie.')
  process.exit(coverage === 0 && parsed.length > 0 ? 2 : 0)
}

const missing = parsed.filter(p => !haveNumbers.has(p.wix_order_number))
missing.sort((a, b) => a.wix_order_number - b.wix_order_number)

console.log('')
console.log(`BRAKUJE W SUPABASE: ${missing.length} zamówień`)
for (const m of missing) {
  console.log(`  nr ${m.wix_order_number}  ${m.businessDay}  ${m.amount.toFixed(2)} zł  ${m.product_name_raw.slice(0, 44)}`)
}

if (missing.length === 0) {
  console.log('')
  console.log('PASS — nic do dopisania.')
  process.exit(0)
}

if (!apply) {
  console.log('')
  console.log('PRÓBA NA SUCHO. Dodaj --apply, żeby wstawić te wiersze.')
  process.exit(0)
}
if (!WRITE_KEY) {
  console.error('')
  console.error('FAIL — zapis wymaga SUPABASE_SERVICE_ROLE_KEY; mam tylko klucz anon.')
  process.exit(1)
}

// ── insert, only what is missing ─────────────────────────────────────────────
// on_conflict on the unique index means a row that appeared between the read
// and the write is left alone rather than duplicated or overwritten.
const payload = missing.map(m => ({
  external_order_id: `wix-${m.wix_order_number}`,
  wix_order_number: m.wix_order_number,
  order_created_at: m.order_created_at,
  amount: m.amount,
  email: m.email || null,
  product_name_raw: m.product_name_raw || null,
  source: 'wix',
  payment_status: m.status || 'paid',
}))

const inserted = await pg('orders?on_conflict=wix_order_number', {
  method: 'POST',
  write: true,
  headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
  body: JSON.stringify(payload),
})

console.log('')
console.log(`WSTAWIONO: ${Array.isArray(inserted) ? inserted.length : 0} wierszy`)
console.log('Istniejące wiersze nie zostały ruszone.')
