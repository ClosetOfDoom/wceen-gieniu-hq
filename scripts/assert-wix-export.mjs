#!/usr/bin/env node
// One reader for the Wix export, and only one.
//
// There were two. backfill-order-numbers.mjs carried its own CSV parser and
// its own idea of the file's shape, and every one of its ideas was wrong: it
// read the merged banner row as the header, it looked for a column called
// "Produkt" in a file whose column is "Nazwa", and it dated rows with a parser
// that returns NaN for "19.10.2026, 10:05:54". It had never been run against a
// real export, so nothing caught it.
//
// The failure mode of a second parser is not a crash. It is a number that
// looks plausible and is wrong — "0 orders missing" from a file the reader
// could not read. This guard makes the second parser impossible to add
// quietly.

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root
const scriptsDir = join(rootDir, 'scripts')
const READER = '_wixExport.mjs'

let errors = 0
const pass = (m) => console.log(`  pass ${m}`)
const fail = (m) => { console.log(`  FAIL ${m}`); errors++ }

console.log('Wix export reader discipline')
console.log('')

/**
 * Code with the comments taken out.
 *
 * Without this the guard reads an explanation of a bug as the bug itself:
 * these files describe the old date parser in prose, and a naive search finds
 * the description and calls it a violation.
 */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/)
  .map(line => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
  .join('\n')

const reader = code(readFileSync(join(scriptsDir, READER), 'utf8'))

// The four things that were wrong before, each pinned so none can come back.
if (/data platnosci/.test(reader) && /findIndex/.test(reader)) {
  pass(`${READER}: finds the header row instead of assuming row 1`)
} else {
  fail(`${READER}: must locate the header row by its content`)
}

if (/\\d\{1,2\}\)\\\.\(\\d\{1,2\}/.test(reader)) {
  pass(`${READER}: accepts a day or month without a leading zero (9.10.2026)`)
} else {
  fail(`${READER}: the date pattern must accept "9.10.2026", not only "09.10.2026"`)
}

if (/offsetFromHeader/.test(reader) && /nie podaje strefy/.test(reader)) {
  pass(`${READER}: reads the timezone out of the header and refuses without one`)
} else {
  fail(`${READER}: the timezone must come from the header, never be assumed`)
}

if (/Date\.parse\(/.test(reader)) {
  fail(`${READER}: parses an export timestamp with Date.parse, which cannot read it`)
} else {
  pass(`${READER}: builds the timestamp itself instead of handing it to Date.parse`)
}

// Nobody else may parse this file. This guard is excluded from its own sweep:
// it names the columns and the parser in order to forbid them, which is the
// opposite of using them.
const consumers = readdirSync(scriptsDir)
  .filter(f => f.endsWith('.mjs') && f !== READER && f !== 'assert-wix-export.mjs')

const offenders = []
for (const f of consumers) {
  const src = code(readFileSync(join(scriptsDir, f), 'utf8'))
  const parsesCsv = /function parseCsv/.test(src)
  const knowsColumns = /nr zamowienia|Nr zamówienia|data platnosci/i.test(src)
  if (!parsesCsv && !knowsColumns) continue
  if (!src.includes(`from './${READER}'`)) {
    offenders.push(`scripts/${f} touches the Wix export but does not import ${READER}`)
  }
  if (parsesCsv) offenders.push(`scripts/${f} defines its own CSV parser`)
}

if (offenders.length === 0) {
  pass(`every script that reads the Wix export goes through ${READER}`)
} else {
  for (const o of offenders) fail(o)
}

// The reconciler must stay read-only. It holds no write credential, and it
// must not grow one: a tool that reports losses and also writes could cover
// its own tracks.
const reconcile = code(readFileSync(join(scriptsDir, 'reconcile-wix-export.mjs'), 'utf8'))
if (/SERVICE_ROLE|method:\s*['"]POST|method:\s*['"]PATCH|method:\s*['"]DELETE/.test(reconcile)) {
  fail('reconcile-wix-export.mjs must stay read-only — no write key, no write method')
} else {
  pass('reconcile-wix-export.mjs is read-only (no write credential, no write method)')
}

// ── the two loss detectors, and the rule that neither glows on nothing ──────
//
// A detector that cannot see what it claims to watch is worse than no
// detector: it reports "all clear" with the same confidence it would report a
// problem. Both of these are off, both for a measured reason, and neither may
// be reconnected by accident.
const orderWindow = readFileSync(join(rootDir, 'src/lib/orderWindow.ts'), 'utf8')
const app = code(readFileSync(join(rootDir, 'src/App.tsx'), 'utf8'))

const backlogOff = /SYNC_BACKLOG_DETECTOR_ACTIVE\s*=\s*false/.test(orderWindow)
const gapOff = /NUMBER_GAP_DETECTOR_ACTIVE\s*=\s*false/.test(orderWindow)

if (backlogOff) {
  pass('SYNC_BACKLOG_DETECTOR_ACTIVE is false (measured precision 0.9%)')
  // Every call in the app has to sit behind the flag, or the flag is decoration.
  const calls = app.split('assessSyncHealth(').length - 1
  const gated = app.split(/SYNC_BACKLOG_DETECTOR_ACTIVE\s*&&/).length - 1
  if (calls === 0 || gated >= 1) {
    pass('App.tsx does not run the backlog detector while the flag is false')
  } else {
    fail(`App.tsx calls assessSyncHealth ${calls}× with no SYNC_BACKLOG_DETECTOR_ACTIVE gate`)
  }
} else {
  pass('SYNC_BACKLOG_DETECTOR_ACTIVE is true — somebody turned it back on deliberately')
}

if (gapOff) {
  pass('NUMBER_GAP_DETECTOR_ACTIVE is false (column unapplied, Make not mapping it)')
  // Reading an empty column and showing "no gaps" is the failure this prevents.
  const readers = readdirSync(join(rootDir, 'src/lib'))
    .filter(f => f.endsWith('.ts') && !f.includes('.test.'))
    .filter(f => /wix_order_number/.test(code(readFileSync(join(rootDir, 'src/lib', f), 'utf8'))))
  if (readers.length === 0 && !/wix_order_number/.test(app)) {
    pass('nothing in the app reads wix_order_number while the column is empty')
  } else {
    fail(`these read wix_order_number although the gap detector is off: ${[...readers, 'App.tsx'].join(', ')}`)
  }
} else {
  pass('NUMBER_GAP_DETECTOR_ACTIVE is true — the column must be populated by now')
}

console.log('')
if (errors > 0) {
  console.error(`FAIL — ${errors} Wix export violation(s).`)
  process.exit(1)
}
console.log('PASS — one reader for the Wix export, both loss detectors accounted for.')
