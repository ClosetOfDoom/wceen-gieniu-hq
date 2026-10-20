#!/usr/bin/env node
// Put the Wix Pricing Plans orders into Supabase — the channel the sync has
// never been subscribed to.
//
//   node scripts/backfill-pricing-plans.mjs "payments (17).csv"            # dry run
//   node scripts/backfill-pricing-plans.mjs "payments (17).csv" --apply    # write
//
// NOT RUN YET. It needs two things first, and it refuses to start without
// either, naming which one is missing:
//
//   1. supabase/migrations/20261020_order_channel.sql applied, so the rows it
//      inserts can say which channel they came from. Without it every Pricing
//      Plans row would be indistinguishable from an eCom order the moment it
//      landed, and this script exists precisely to stop that.
//   2. SUPABASE_SERVICE_ROLE_KEY. The anon key is refused by RLS silently —
//      HTTP 200 with an empty array — so a run on the anon key would see no
//      existing orders, conclude that everything is missing, and insert
//      duplicates of the entire table. It reads with the service key or it
//      does not read at all.
//
// RULES IT WILL NOT BREAK
//   · INSERT only. A row already in Supabase is never updated, never
//     overwritten, never touched.
//   · Idempotent: the second run inserts nothing.
//   · Identity is the Wix id from the export's "Nr zamówienia" column, which
//     for a Pricing Plans payment is a UUID. That is what makes the second run
//     a no-op, so a row whose id cannot be read is reported and skipped rather
//     than inserted under a made-up one.
//   · It never invents a product, a margin or a channel. Classification is
//     productCatalog.js, exactly as everywhere else.
//
// WHAT IT DOES NOT CARRY
// ---------------------------------------------------------------------------
// Billing cycle, frequency, period, subscription status. The export has all
// four columns and all four are empty on every Pricing Plans row, so there is
// nothing to carry. See 20261020_order_channel.sql.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { readWixPaymentsExport } from './_wixExport.mjs'
import { businessDay, businessWallClock } from '../netlify/shared/businessDay.js'
import { classifyAmount, PRODUCTS } from '../netlify/shared/productCatalog.js'

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
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const file = process.argv[2]
const apply = process.argv.includes('--apply')
const CHANNEL = 'Pricing Plans'

if (!file || !existsSync(file)) {
  console.error('usage: node scripts/backfill-pricing-plans.mjs <wix-payments-export.csv> [--apply]')
  if (file) console.error(`  nie ma pliku: ${file}`)
  process.exit(1)
}
if (!SUPA_URL) {
  console.error('FAIL — brak SUPABASE_URL (sprawdzono env i .env)')
  process.exit(1)
}
if (!KEY) {
  console.error('FAIL — brak SUPABASE_SERVICE_ROLE_KEY.')
  console.error('')
  console.error('  Nie używam klucza anon jako zamiennika. RLS odrzuca go po cichu:')
  console.error('  zwraca HTTP 200 i pustą tablicę, więc skrypt uznałby, że tabela jest')
  console.error('  pusta, i wstawił 32 zamówienia obok tych, które już tam są.')
  process.exit(1)
}

const fmt = (n) => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function pg(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json', Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

// ── the column has to exist before anything else happens ─────────────────────
try {
  await pg('orders?select=order_channel&limit=1')
} catch (e) {
  if (/order_channel does not exist/.test(String(e?.message ?? e))) {
    console.error('FAIL — kolumny orders.order_channel jeszcze nie ma.')
    console.error('')
    console.error('  Wgraj supabase/migrations/20261020_order_channel.sql w edytorze SQL')
    console.error('  w Supabase i uruchom ten skrypt ponownie. Bez tej kolumny wstawione')
    console.error('  zamówienia Pricing Plans byłyby nieodróżnialne od eCom-owych.')
    process.exit(1)
  }
  throw e
}

// ── what the export says ─────────────────────────────────────────────────────
const xp = readWixPaymentsExport(file)
const candidates = []
const skipped = []
for (const p of xp.payments) {
  if (p.orderKind !== CHANNEL) continue
  if (!p.settled) continue
  if (/test/i.test(p.email)) { skipped.push({ p, why: 'e-mail zawiera "test"' }); continue }
  if (!p.orderNumber) { skipped.push({ p, why: 'brak "Nr zamówienia" — nie mam trwałego id' }); continue }
  candidates.push(p)
}
candidates.sort((a, b) => a.paidAtMs - b.paidAtMs)

console.log(`CSV: ${xp.payments.length} wierszy, ${candidates.length} zrealizowanych płatności z kanału "${CHANNEL}"`)
for (const s of skipped) {
  console.log(`  POMINIĘTE ${businessWallClock(s.p.paidAt)} ${fmt(s.p.amount)} zł — ${s.why}`)
}
if (candidates.length === 0) {
  console.log('Nic do zrobienia.')
  process.exit(0)
}

// ── what Supabase already holds ──────────────────────────────────────────────
// Paged and ordered, like every other read in this repo.
const existing = []
for (let offset = 0; ; offset += 1000) {
  const page = await pg('orders?select=external_order_id'
    + `&order=external_order_id.asc&limit=1000&offset=${offset}`)
  existing.push(...page)
  if (page.length < 1000) break
}
const have = new Set(existing.map(r => r.external_order_id))
console.log(`Supabase: ${existing.length} zamówień`)

const missing = candidates.filter(p => !have.has(p.orderNumber))
console.log('')
console.log(`BRAKUJE: ${missing.length} zamówień · ${fmt(missing.reduce((s, p) => s + p.amount, 0))} zł`)
console.log('  data i godzina (PL)      kwota  produkt wg katalogu   external_order_id')
for (const p of missing) {
  const cls = classifyAmount(p.amount, p.name)
  const prod = cls.productKey ? PRODUCTS[cls.productKey].shortName : `(${p.name.slice(0, 18) || 'bez nazwy'})`
  console.log(`  ${businessWallClock(p.paidAt)}  ${fmt(p.amount).padStart(9)}  ${prod.padEnd(21)} ${p.orderNumber}`)
}

if (missing.length === 0) {
  console.log('')
  console.log('PASS — nic do dopisania. Drugi przebieg nie zmienia niczego, tak ma być.')
  process.exit(0)
}
if (!apply) {
  console.log('')
  console.log('PRÓBA NA SUCHO. Dodaj --apply, żeby wstawić te wiersze.')
  process.exit(0)
}

// ── insert, only what is missing ─────────────────────────────────────────────
// on_conflict means a row that appeared between the read and the write is left
// alone rather than duplicated or overwritten.
const payload = missing.map(p => ({
  external_order_id: p.orderNumber,
  order_created_at:  p.paidAt,
  amount:            p.amount,
  currency:          p.currency || 'PLN',
  email:             p.email || null,
  product_name_raw:  p.name || null,
  source:            'wix',
  payment_status:    'paid',
  order_channel:     CHANNEL,
}))

const inserted = await pg('orders?on_conflict=external_order_id', {
  method: 'POST',
  headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
  body: JSON.stringify(payload),
})

console.log('')
console.log(`WSTAWIONO: ${Array.isArray(inserted) ? inserted.length : 0} wierszy`)
console.log('Istniejące wiersze nie zostały ruszone.')
console.log('')
console.log('Sprawdź na pulpicie dni:', [...new Set(missing.map(p => businessDay(p.paidAt)))].sort().join(', '))
