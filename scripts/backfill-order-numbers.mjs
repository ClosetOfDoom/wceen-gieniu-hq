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
import { readWixPaymentsExport } from './_wixExport.mjs'

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
// Parsing lives in _wixExport.mjs, shared with reconcile-wix-export.mjs. It
// used to live here too, in a second copy that got the file wrong three ways:
// it read the merged banner as the header, it looked for a column called
// "Produkt" in a file whose column is "Nazwa", and Date.parse() returns NaN
// for "19.10.2026, 10:05:54". Two readers meant two answers; now there is one.

let xp
try {
  xp = readWixPaymentsExport(file)
} catch (e) {
  console.error(`FAIL — ${String(e?.message ?? e)}`)
  process.exit(1)
}

const parsed = []
const skipped = []
for (const p of xp.payments) {
  const number = /^\d+$/.test(String(p.orderNumber)) ? Number(p.orderNumber) : null
  // A payment that never settled is not an order, and must never be inserted.
  if (!p.settled) continue
  if (number == null) {
    skipped.push(p)
    continue
  }
  parsed.push({
    wix_order_number: number,
    order_created_at: p.paidAt,
    businessDay: businessDay(p.paidAt),
    amount: p.amount,
    email: p.email,
    product_name_raw: p.name,
    status: p.statusRaw,
  })
}

console.log(`CSV: ${xp.payments.length} wierszy, ${parsed.length} zrealizowanych z numerem zamówienia`)
if (xp.unparsable.length > 0) {
  console.log(`  NIEPARSOWALNE: ${xp.unparsable.length} — nie zgaduję, popraw plik i uruchom ponownie`)
  for (const u of xp.unparsable.slice(0, 10)) {
    console.log(`    linia ${u.line}: data=${u.date} kwota=${u.amount}`)
  }
}
if (skipped.length > 0) {
  console.log(`  BEZ NUMERU: ${skipped.length} zrealizowanych płatności, w których`)
  console.log('    "Nr zamówienia" nie jest liczbą, tylko UUID-em. Pomijam je — nie da')
  console.log('    się ich wpisać do kolumny, która ma wykrywać luki w numeracji.')
  const kinds = new Map()
  for (const p of skipped) kinds.set(p.orderKind || '(puste)', (kinds.get(p.orderKind || '(puste)') ?? 0) + 1)
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(6)}  ${k}`)
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
  const msg = String(e?.message ?? e)
  console.error(`FAIL — nie mogę odczytać orders: ${msg}`)
  if (/wix_order_number does not exist/.test(msg)) {
    console.error('')
    console.error('  Kolumny jeszcze nie ma. Wgraj supabase/migrations/20261019_wix_order_number.sql')
    console.error('  w edytorze SQL w Supabase i uruchom ten skrypt ponownie.')
  } else {
    console.error('  Jeśli odpowiedź jest pusta zamiast błędna: klucz anon jest blokowany przez')
    console.error('  RLS po cichu (HTTP 200 + []). Do zapisu i tak potrzebny SUPABASE_SERVICE_ROLE_KEY.')
  }
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
