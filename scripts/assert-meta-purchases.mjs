#!/usr/bin/env node
// Does the ingest actually fetch Meta's purchases? Ask Business Manager.
//
//   node scripts/assert-meta-purchases.mjs --from 2026-10-20 --to 2026-10-26 --expect 46
//   node scripts/assert-meta-purchases.mjs --from 2026-10-20 --to 2026-10-26 --expect 46 \
//        --campaign "PP-22.06.2026" --spend 3375.52
//
// The number in --expect comes from a human reading Business Manager. There is
// no API call here that could confirm it: the whole point is that the pipeline
// cannot be trusted to report on itself. A figure typed in from the screen is
// the only independent check available.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// On 2026-10-27, Business Manager reported 46 purchases for PP-22.06.2026 over
// 2026-10-20…26, split across two ads with CPAs of 70,05 and 82,82 PLN.
// meta_ads_daily held 5 for the same window, all of them on the final day:
//
//     20.10 → 0   21.10 → 0   22.10 → 0   23.10 → 0   24.10 → 0
//     25.10 → 0   26.10 → 5
//
// Until that is fixed, the dashboard shows no CPA or ROAS computed from
// meta_purchases, and the ŚWIAT META section stays switched off. This script
// is the gate: when it passes, those can come back.
//
// It is READ-ONLY and holds no write credential.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

const args = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback
}

const FROM = flag('--from')
const TO = flag('--to')
const EXPECT = flag('--expect')
const EXPECT_SPEND = flag('--spend')
const CAMPAIGN = flag('--campaign')
const BASE = flag('--base', 'https://elegant-kelpie-6fdfc8.netlify.app')
/** How far the DB may sit from Business Manager and still count as a match. */
const TOLERANCE_PCT = Number(flag('--tolerance', '2'))

if (!FROM || !TO || EXPECT == null) {
  console.error('usage: node scripts/assert-meta-purchases.mjs --from YYYY-MM-DD --to YYYY-MM-DD --expect N')
  console.error('')
  console.error('  --expect   liczba zakupów z Business Managera za ten zakres (odczytana z ekranu)')
  console.error('  --spend    opcjonalnie: wydatek z BM, żeby sprawdzić i tę stronę')
  console.error('  --campaign opcjonalnie: ogranicz do jednej kampanii, dokładna nazwa')
  process.exit(1)
}

const expected = Number(EXPECT)
if (!Number.isFinite(expected) || expected < 0) {
  console.error(`FAIL — --expect ${EXPECT} nie jest liczbą zakupów`)
  process.exit(1)
}

const pln = (n) => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
let failures = 0
const pass = (m) => console.log(`  pass ${m}`)
const fail = (m) => { console.error(`  FAIL ${m}`); failures++ }

// ── what the database holds ─────────────────────────────────────────────────
// Through the deployed function: meta_ads_daily is closed to the anon key, and
// the service key lives only in Netlify.
const res = await fetch(`${BASE}/.netlify/functions/campaign-data?from=${FROM}&to=${TO}`)
if (!res.ok) {
  console.error(`FAIL — campaign-data HTTP ${res.status}`)
  process.exit(1)
}
const body = await res.json()
if (!body.ok) {
  console.error(`FAIL — campaign-data: ${body.error ?? 'nie ok'}`)
  process.exit(1)
}

const rows = (body.rows ?? []).filter(r => !CAMPAIGN || r.campaign_name === CAMPAIGN)
const dbPurchases = rows.reduce((s, r) => s + (r.meta_purchases ?? r.purchases ?? 0), 0)
const dbSpend = rows.reduce((s, r) => s + (r.spend ?? 0), 0)
const dates = body.datesPresent ?? []

console.log('')
console.log(`Zakres: ${FROM} → ${TO}${CAMPAIGN ? ` · kampania "${CAMPAIGN}"` : ' · wszystkie kampanie'}`)
console.log(`Dni z danymi w bazie: ${dates.length}${dates.length ? ` (${dates[0]} … ${dates[dates.length - 1]})` : ''}`)
console.log('')
console.log(`  Business Manager (podane ręcznie): ${expected} zakupów`
  + (EXPECT_SPEND != null ? ` · ${pln(EXPECT_SPEND)} PLN` : ''))
console.log(`  meta_ads_daily:                    ${dbPurchases} zakupów · ${pln(dbSpend)} PLN`)
console.log('')

// ── purchases ───────────────────────────────────────────────────────────────
const gap = dbPurchases - expected
const allowed = Math.max(1, Math.round(expected * TOLERANCE_PCT / 100))
if (expected === 0 && dbPurchases === 0) {
  pass('obie strony zero — nie ma czego porównywać, podaj zakres z realnymi zakupami')
} else if (Math.abs(gap) <= allowed) {
  pass(`zakupy zgodne: ${dbPurchases} vs ${expected} (różnica ${gap}, dopuszczalna ${allowed})`)
} else {
  fail(`zakupy NIEZGODNE: baza ma ${dbPurchases}, Business Manager ${expected} `
    + `(brakuje ${-gap}, czyli ${((-gap / expected) * 100).toFixed(0)}%)`)
}

// ── where the gap sits ──────────────────────────────────────────────────────
// A feed that is merely late looks different from one that is not running: the
// first is missing its recent days, the second is empty everywhere.
//
// Queried a day at a time on purpose: campaign-data's range mode groups rows
// per creative and stamps every group with the LAST date in the window, so
// reading r.date from a range response would report the whole week as one day.
const byDay = new Map()
for (let d = new Date(FROM + 'T12:00:00Z'); d <= new Date(TO + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
  const day = d.toISOString().slice(0, 10)
  const r1 = await fetch(`${BASE}/.netlify/functions/campaign-data?from=${day}&to=${day}`)
  if (!r1.ok) continue
  const b1 = await r1.json()
  const dayRows = (b1.rows ?? []).filter(r => !CAMPAIGN || r.campaign_name === CAMPAIGN)
  if (dayRows.length === 0) continue
  byDay.set(day, dayRows.reduce((s, r) => s + (r.meta_purchases ?? r.purchases ?? 0), 0))
}
const zeroDays = [...byDay.entries()].filter(([, n]) => n === 0).map(([d]) => d)
console.log('')
console.log('  zakupy dzień po dniu:')
for (const [d, n] of [...byDay].sort()) {
  console.log(`    ${d}  ${String(n).padStart(4)}${n === 0 ? '   ← zero' : ''}`)
}
if (zeroDays.length === byDay.size && byDay.size > 0) {
  console.log('')
  console.log('  Każda doba zeruje się. To nie jest opóźnienie atrybucji — pole nie jest pobierane.')
} else if (zeroDays.length > 0) {
  console.log('')
  console.log(`  ${zeroDays.length} z ${byDay.size} dób zeruje się: ${zeroDays.join(', ')}`)
}

// ── spend, when given ───────────────────────────────────────────────────────
if (EXPECT_SPEND != null) {
  const sGap = dbSpend - Number(EXPECT_SPEND)
  const sAllowed = Math.max(1, Number(EXPECT_SPEND) * TOLERANCE_PCT / 100)
  if (Math.abs(sGap) <= sAllowed) {
    pass(`wydatek zgodny: ${pln(dbSpend)} vs ${pln(EXPECT_SPEND)} PLN (różnica ${pln(sGap)})`)
  } else {
    fail(`wydatek NIEZGODNY: baza ${pln(dbSpend)}, BM ${pln(EXPECT_SPEND)} (różnica ${pln(sGap)} PLN)`)
  }
}

// ── the flag this gates ─────────────────────────────────────────────────────
const owFile = join(rootDir, 'src/lib/orderWindow.ts')
if (existsSync(owFile)) {
  const active = /META_WORLD_ACTIVE\s*=\s*true/.test(readFileSync(owFile, 'utf8'))
  console.log('')
  if (failures === 0 && !active) {
    console.log('  Zgodność jest. Możesz włączyć META_WORLD_ACTIVE w src/lib/orderWindow.ts')
    console.log('  i przywrócić CPA/ROAS liczone z Meta.')
  } else if (failures > 0 && active) {
    fail('META_WORLD_ACTIVE jest WŁĄCZONE, a liczby się nie zgadzają — wyłącz je')
  } else if (failures > 0) {
    console.log('  META_WORLD_ACTIVE pozostaje wyłączone — słusznie.')
  }
}

console.log('')
if (failures > 0) {
  console.error(`FAIL — ${failures} niezgodność(i). Ingest nie pobiera kompletu.`)
  process.exit(1)
}
console.log('PASS — baza zgadza się z Business Managerem w podanym zakresie.')
