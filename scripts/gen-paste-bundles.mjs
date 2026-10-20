#!/usr/bin/env node
// Assembles the two files you paste into the Supabase SQL editor.
//
//   node scripts/gen-paste-bundles.mjs          # write
//   node scripts/gen-paste-bundles.mjs --check  # fail if stale (used by verify)
//
// NOTHING HERE IS NEW SQL. Every statement comes from a file in
// supabase/migrations/; this only concatenates them in a safe order and makes
// three mechanical corrections that are listed in the output header, so the
// bundle cannot quietly diverge from the migrations it is built from.
//
// WHY A GENERATOR AND NOT A HAND-WRITTEN FILE
// ---------------------------------------------------------------------------
// A pasted bundle is a copy. The moment somebody edits a migration and forgets
// the copy, the thing being pasted into the production database stops being
// the thing in the repo — and that divergence is invisible until it breaks
// something. `npm run verify` regenerates and compares.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root
const MIG = join(rootDir, 'supabase/migrations')

/**
 * The order to apply them in, and why each one is where it is.
 *
 * The register goes first because every migration after it writes a row into
 * the table it creates. The rest are ordered tables → columns → view, so no
 * statement refers to something that does not exist yet.
 */
const ORDER = [
  ['20261020_applied_migrations.sql',
   'Rejestr migracji — tabela applied_migrations, którą czyta panel MIGRACJE.',
   'Musi być pierwsza: każda kolejna sekcja dopisuje się do tej tabeli.'],
  ['add_order_items_for_product_scoping.sql',
   'Tabela wix_order_items (pozycje zamówień) + indeksy + RLS.',
   'Sprawdzone 2026-10-20: tabela nie istnieje (HTTP 404), więc migracja nigdy nie poszła.'],
  ['add_funding_checks.sql',
   'Tabela funding_checks (terminy sprawdzania dotacji) + trigger + polityka RLS.',
   'Sprawdzone 2026-10-20: tabela nie istnieje (HTTP 404).'],
  ['add_meta_ads_daily_unique.sql',
   'Unikalny indeks na meta_ads_daily (date, ad_id) — blokuje podwójny ingest.',
   'Stanu nie da się sprawdzić przez REST (indeksy są niewidoczne). '
   + 'CREATE UNIQUE INDEX IF NOT EXISTS, więc wklejenie jest bezpieczne w obie strony. '
   + 'UWAGA: jeśli w tabeli SĄ duplikaty, ta instrukcja się wywali i cofnie CAŁĄ transakcję '
   + '— pierwszy SELECT w tej sekcji je pokaże.'],
  ['20261019_wix_order_number.sql',
   'orders.wix_order_number — numer zamówienia Wix, do wykrywania luk w numeracji.',
   'Kolumna nie istnieje (HTTP 400). Po wgraniu będzie pusta — wypełni ją Make.'],
  ['20261020_order_channel.sql',
   'orders.order_channel — eCom Platform vs Pricing Plans.',
   'Kolumna nie istnieje (HTTP 400). Zawiera UPDATE, który wpisuje "eCom Platform" '
   + 'w świeżo utworzoną kolumnę tam, gdzie jest NULL. Nic nie nadpisuje — kolumna '
   + 'powstaje w tej samej transakcji i przed UPDATE jest pusta w każdym wierszu.'],
  ['20261020_payment_provider.sql',
   'orders.payment_provider — operator płatności Wix.',
   'Kolumna nie istnieje (HTTP 400). Po wgraniu pusta — wypełni ją Make.'],
  ['20260928_warsaw_business_day.sql',
   'Przebudowa widoku v_daily_wix_meta_performance na dobę Europe/Warsaw.',
   'Sprawdzone 2026-10-20: widok liczy 86 zamówień za 09-15.10 przy 87 w dobie '
   + 'warszawskiej i 2 zamówieniach granicznych — czyli nadal tnie po UTC. '
   + 'Definicja zachowuje meta_purchases i meta_purchase_value (zdiffowane).'],
  ['20261003_meta_reach_initiate_checkout.sql',
   'meta_ads_daily.reach + initiate_checkout.',
   'Obie kolumny nie istnieją (HTTP 400). Po wgraniu puste — wypełni je ingest Meta.'],
]

/** Already applied, so not pasted — only recorded, or the panel keeps naming it. */
const ALREADY_APPLIED = [
  ['add_meta_purchases_to_view.sql',
   'widok faktycznie wystawia meta_purchases (HTTP 200) — zastosowana 2026-06-23'],
]

const DEDUP = '20261020_dedup_august_duplicates.sql'

// ── mechanical corrections, listed so they are not invisible ────────────────
const FIXES = []

/** Strip a file's own BEGIN/COMMIT — the bundle wraps everything in one. */
function stripTransaction(sql, file) {
  if (!/^BEGIN;\s*$/m.test(sql)) return sql
  FIXES.push(`${file}: usunięte własne BEGIN;/COMMIT; — w pakiecie jest jedna wspólna `
    + 'transakcja, a zagnieżdżony COMMIT zamknąłby ją w połowie')
  return sql.replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '')
}

/** The one statement in the whole set that cannot be pasted twice. */
function makePolicyIdempotent(sql, file) {
  const needle = 'CREATE POLICY "anon read" ON public.wix_order_items'
  if (!sql.includes(needle)) return sql
  FIXES.push(`${file}: dodane DROP POLICY IF EXISTS przed CREATE POLICY "anon read" `
    + '— jedyna instrukcja w całym zestawie, która przy drugim wklejeniu rzuciłaby '
    + 'błąd 42710 (polityka już istnieje)')
  return sql.replace(needle,
    'DROP POLICY IF EXISTS "anon read" ON public.wix_order_items;\n' + needle)
}

/** Legacy files predate the register and do not record themselves. */
function addRegistration(sql, file) {
  if (sql.includes('applied_migrations')) return sql
  FIXES.push(`${file}: dopisana rejestracja w applied_migrations — plik powstał przed `
    + 'rejestrem, więc sam się nie zgłasza i panel pokazywałby go jako niezastosowany')
  return sql.trimEnd() + `\n\nINSERT INTO public.applied_migrations (filename)\n`
    + `  VALUES ('${file}')\n  ON CONFLICT (filename) DO NOTHING;\n`
}

/**
 * Remove `--` comments, knowing when a `--` is not a comment.
 *
 * A naive line filter is wrong twice over: it would cut a line inside a
 * dollar-quoted function body, and an apostrophe in prose ("Stanley's") would
 * confuse any quote-counting shortcut. So this walks the text and tracks three
 * states — single-quoted literal, dollar-quoted block, line comment — which is
 * the only way to know whether a given `--` opens a comment or is just two
 * characters inside a string.
 *
 * The migrations keep their full reasoning; the bundle is the thing you paste,
 * and 880 lines of prose is not what you want in a SQL editor at 1am.
 */
function stripComments(sql) {
  let out = '', i = 0
  let inStr = false, dollarTag = null
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { out += dollarTag; i += dollarTag.length; dollarTag = null }
      else { out += sql[i++] }
      continue
    }
    if (inStr) {
      if (sql[i] === "'" && sql[i + 1] === "'") { out += "''"; i += 2; continue }
      if (sql[i] === "'") inStr = false
      out += sql[i++]
      continue
    }
    const dq = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i))
    if (dq) { dollarTag = dq[0]; out += dollarTag; i += dollarTag.length; continue }
    if (sql[i] === "'") { inStr = true; out += sql[i++]; continue }
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    out += sql[i++]
  }
  // Collapse the blank lines the comments left behind.
  return out.split('\n').map(l => l.replace(/\s+$/, ''))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const bar = (ch = '─') => '-- ' + ch.repeat(74)

function section(file, what, expect) {
  let sql = readFileSync(join(MIG, file), 'utf8').replace(/\r\n/g, '\n')
  sql = stripTransaction(sql, file)
  sql = makePolicyIdempotent(sql, file)
  sql = addRegistration(sql, file)
  sql = stripComments(sql)
  return [
    '',
    bar('═'),
    `-- ${file}`,
    bar('═'),
    `-- CO ROBI:      ${what}`,
    ...expect.match(/.{1,70}(\s|$)/g).map((l, i) => `-- ${i === 0 ? 'CZEGO OCZEKIWAĆ:' : '                '} ${l.trim()}`),
    bar('─'),
    '',
    sql.trim(),
    '',
  ].join('\n')
}

// Build the body first: the fix list is only complete once every section ran.
const body = ORDER.map(([f, w, e]) => section(f, w, e)).join('\n')

const header = `-- ═══════════════════════════════════════════════════════════════════════════
-- WSZYSTKIE ZALEGŁE MIGRACJE — JEDEN WKLEJ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WYGENEROWANE przez scripts/gen-paste-bundles.mjs z plików w
-- supabase/migrations/. Nie edytuj tego pliku ręcznie — zmień migrację
-- i uruchom \`npm run gen:paste\`. \`npm run verify\` pilnuje, żeby się nie
-- rozjechało.
--
-- JAK TEGO UŻYĆ
-- ---------------------------------------------------------------------------
--   1. Wklej CAŁOŚĆ do SQL Editora w Supabase i uruchom.
--   2. Przeczytaj wynik ostatniego SELECT-a: ma wypisać ${ORDER.length + ALREADY_APPLIED.length} wierszy
--      w applied_migrations.
--   3. Dopiero potem wklej supabase/_PASTE_2_dedup.sql — osobno, bo tamten
--      kasuje dane i ma się rozbić przy niezgodności.
--
-- CAŁOŚĆ JEST W JEDNEJ TRANSAKCJI. Jeśli cokolwiek pójdzie nie tak, baza
-- wraca do stanu sprzed wklejenia — nie ma stanu połowicznego.
--
-- NIE MA TU ŻADNEGO DELETE. Jedyny UPDATE to wypełnienie świeżo utworzonej
-- kolumny orders.order_channel wartością 'eCom Platform' tam, gdzie jest
-- NULL — a przed tym UPDATE jest ona NULL w każdym wierszu, bo powstaje
-- w tej samej transakcji. Nic istniejącego nie jest nadpisywane.
--
-- WKLEJENIE DWA RAZY NIC NIE PSUJE. Wszystko jest IF NOT EXISTS,
-- CREATE OR REPLACE, DROP ... IF EXISTS albo ON CONFLICT DO NOTHING.
--
-- POMINIĘTE, BO JUŻ ZASTOSOWANE
-- ---------------------------------------------------------------------------
${ALREADY_APPLIED.map(([f, why]) => `--   ${f}\n--       ${why}\n--       Nie wklejamy jej, ale dopisujemy do rejestru, żeby panel przestał ją zgłaszać.`).join('\n')}
--
-- POPRAWKI MECHANICZNE WPROWADZONE PRZY SKŁADANIU
-- ---------------------------------------------------------------------------
${[...new Set(FIXES)].map(f => '--   · ' + f.match(/.{1,70}(\s|$)/g).map((l, i) => (i ? '--     ' : '') + l.trim()).join('\n')).join('\n')}
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;
${body}
${[
  '',
  bar('═'),
  '-- REJESTRACJA MIGRACJI JUŻ ZASTOSOWANYCH',
  bar('═'),
  '-- Nie wklejamy ich SQL-a, ale panel MIGRACJE porównuje katalog repo',
  '-- z tą tabelą, więc bez wpisu zgłaszałby je jako brakujące.',
  '',
  'INSERT INTO public.applied_migrations (filename, note) VALUES',
  ALREADY_APPLIED.map(([f, why]) => `  ('${f}', '${why.replace(/'/g, "''")}')`).join(',\n'),
  'ON CONFLICT (filename) DO NOTHING;',
  '',
].join('\n')}
${bar('═')}
-- KONTROLA — przeczytaj to, zanim uznasz, że poszło dobrze
${bar('═')}
-- Ma wypisać ${ORDER.length + ALREADY_APPLIED.length} wierszy. Jeśli jest ich mniej, któraś sekcja nie
-- dopisała się do rejestru i trzeba zobaczyć dlaczego.
SELECT filename, applied_at, coalesce(note, '') AS note
  FROM public.applied_migrations
 ORDER BY filename;

COMMIT;

-- Po COMMIT odśwież pulpit (Unregister SW + clear cache). Panel MIGRACJE
-- w Diagnostics ma pokazać wszystkie pliki jako zastosowane, poza
-- ${DEDUP},
-- który wklejasz osobno.
`

// ── file B: the de-duplication, untouched ──────────────────────────────────
const dedupHeader = `-- ═══════════════════════════════════════════════════════════════════════════
-- DEDUPLIKACJA 15-20.08 — WKLEJAJ DOPIERO PO _PASTE_1_all_pending.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WYGENEROWANE przez scripts/gen-paste-bundles.mjs. Treść poniżej jest
-- DOKŁADNĄ kopią supabase/migrations/${DEDUP},
-- bez żadnych zmian.
--
-- DLACZEGO OSOBNO
-- ---------------------------------------------------------------------------
-- To jedyny plik, który KASUJE DANE — 67 zduplikowanych zamówień. Ma własnego
-- strażnika, który przerywa całość, jeśli liczba wierszy nie wynosi dokładnie
-- 67, i własny SELECT kontrolny tuż przed COMMIT.
--
-- JAK TEGO UŻYĆ
-- ---------------------------------------------------------------------------
--   1. Najpierw _PASTE_1_all_pending.sql. Krok 3 poniżej przepisuje numery
--      zamówień na wiersze, które zostają, a potrzebuje do tego kolumny
--      orders.wix_order_number — jeśli jej nie ma, krok sam się pominie
--      z NOTICE i numery przepadną z bazy (zostaną tylko w docs/).
--   2. Wklej całość, ale NIE klikaj dalej po COMMIT na ślepo:
--      przeczytaj wynik SELECT-a z kroku 5 i porównaj z liczbami
--      wypisanymi pod nim w komentarzu.
--   3. Zgadza się → COMMIT jest już w pliku, poszło.
--      Nie zgadza się → wpisz ROLLBACK; i napisz, co wyszło.
-- ═══════════════════════════════════════════════════════════════════════════

`
const dedupBody = readFileSync(join(MIG, DEDUP), 'utf8').replace(/\r\n/g, '\n')

const OUT_1 = join(rootDir, 'supabase/_PASTE_1_all_pending.sql')
const OUT_2 = join(rootDir, 'supabase/_PASTE_2_dedup.sql')
const files = [[OUT_1, header], [OUT_2, dedupHeader + dedupBody]]

if (process.argv.includes('--check')) {
  let stale = 0
  for (const [path, want] of files) {
    const have = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : ''
    if (have === want) console.log(`  pass ${path.split(/[\\/]/).pop()} matches supabase/migrations/`)
    else { console.error(`  FAIL ${path.split(/[\\/]/).pop()} is stale — run: npm run gen:paste`); stale++ }
  }
  process.exit(stale > 0 ? 1 : 0)
}

for (const [path, content] of files) {
  writeFileSync(path, content, 'utf8')
  console.log(`${path.split(/[\\/]/).pop()}: ${content.split('\n').length} linii`)
}
