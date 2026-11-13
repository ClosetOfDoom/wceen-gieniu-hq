#!/usr/bin/env node
// Guard: which ad spend may divide Wix orders is decided in ONE place.
//
//   netlify/shared/adSpend.js
//
// Cogni (COGNI-*) is sold through Stripe, so its spend must not be the
// denominator of CPA / ROAS / est. profit computed from Wix orders. That rule —
// the prefix table, EXCLUDED_FROM_WIX_BLENDED, the split — lives there and
// nowhere else. This script fails the build if a second copy appears:
//
//   1. a campaign-name prefix test (/^pp/, startsWith('3T-'), /^cogni/ …) outside it
//   2. a comparison with the 'cogni' scope literal outside it
//      (use isExcludedFromWixBlended(scope))
//   3. a second definition of the shared helpers / constants
//   4. a Netlify function that reads Meta spend (meta_ads_daily, or the view's
//      meta_spend) without importing the shared module
//   5. the shared module losing a piece the others rely on
//
// Pure text checks — no network, no build. Wired into `npm run verify`.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, sep } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
const fail = (m) => { console.error('  FAIL', m); errors++ }
const pass = (m) => console.log('  pass', m)

const SHARED = 'netlify/shared/adSpend.js'
// Files that legitimately mention the rule: the rule itself, its typings and
// re-export, its tests, and this guard.
const EXEMPT = new Set([
  SHARED,
  'netlify/shared/adSpend.d.ts',
  'src/lib/adSpend.ts',
  'scripts/assert-ad-spend-scope.mjs',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(js|mjs|ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const rel = (p) => relative(rootDir, p).split(sep).join('/')

/** Code only: drops whole-line comments and trailing `// …` so prose can talk about Cogni. */
function code(src) {
  return src.split(/\r?\n/).map((l, i) => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return [i + 1, '']
    return [i + 1, l.replace(/(^|[^:'"`])\/\/.*$/, '$1')]
  })
}

const files = [
  ...walk(join(rootDir, 'netlify')),
  ...walk(join(rootDir, 'src')),
  ...walk(join(rootDir, 'scripts')),
].map(rel).filter(f => !EXEMPT.has(f) && !f.includes('__tests__'))

// ── 1 + 2 + 3: no copy of the rule ──────────────────────────────────────────
const PREFIX_TEST = [
  /\/\^\(?\s*(?:pp|3t|cogni)\b/i,                           // /^pp… /^3t… /^cogni…
  /startsWith\(\s*['"`](?:pp|3t|cogni)\b/i,                 // startsWith('PP-')
  /\.(?:test|match)\(.*\b(?:cogni|3t-|pp-)/i,
]
const COGNI_LITERAL = [
  /[=!]==?\s*['"]cogni['"]/,
  /['"]cogni['"]\s*[=!]==?/,
  /includes\(\s*['"]cogni['"]\s*\)/,
  /\[\s*['"]cogni['"]\s*\]/,
  /case\s+['"]cogni['"]/,
]
const REDEFINITION = [
  /\bEXCLUDED_FROM_WIX_BLENDED\s*=/,
  /\bfunction\s+(?:adScopeOf|isExcludedFromWixBlended|splitAdSpend|splitAdSpendByDay|applySpendSplit)\b/,
  /\bconst\s+(?:adScopeOf|isExcludedFromWixBlended|splitAdSpend|splitAdSpendByDay|applySpendSplit)\s*=/,
]

// The PRODUCT catalog has its own 'cogni' scope (what a product is, not which ad
// spend may divide Wix orders). Its guard script compares it; that is the
// product side of the same exclusion, not a copy of this rule.
const PRODUCT_SCOPE_CHECKS = new Set(['scripts/assert-profit-metrics.mjs'])

let copies = 0
for (const f of files) {
  for (const [n, line] of code(readFileSync(join(rootDir, f), 'utf8'))) {
    if (!line) continue
    for (const re of PREFIX_TEST) if (re.test(line)) { fail(`${f}:${n} campaign-prefix test outside ${SHARED}: ${line.trim()}`); copies++ }
    if (!PRODUCT_SCOPE_CHECKS.has(f)) for (const re of COGNI_LITERAL) if (re.test(line)) { fail(`${f}:${n} 'cogni' scope compared outside ${SHARED} — use isExcludedFromWixBlended(): ${line.trim()}`); copies++ }
    for (const re of REDEFINITION) if (re.test(line)) { fail(`${f}:${n} second definition of a shared ad-spend helper: ${line.trim()}`); copies++ }
  }
}
if (copies === 0) pass(`no prefix test, 'cogni' comparison or helper redefinition in ${files.length} other source files`)

// ── 4: every function that reads Meta spend goes through the shared module ──
// data-health.js only reports whether the view has ANY spend (a data-source
// diagnostic); it never divides it into orders, so it is the one exception.
const READS_SPEND_ALLOWED_WITHOUT_SPLIT = new Set(['netlify/functions/data-health.js'])
const fnDir = join(rootDir, 'netlify/functions')
let unguarded = 0
for (const name of readdirSync(fnDir).filter(n => n.endsWith('.js'))) {
  const f = `netlify/functions/${name}`
  const src = readFileSync(join(fnDir, name), 'utf8')
  const readsSpend = /meta_ads_daily/.test(src) && /\bspend\b/.test(src)
    || /\bmeta_spend\b/.test(src)
  if (!readsSpend) continue
  if (READS_SPEND_ALLOWED_WITHOUT_SPLIT.has(f)) { pass(`${f} reads spend for a diagnostic only (allow-listed)`); continue }
  if (/from\s+['"]\.\.\/shared\/adSpend\.js['"]/.test(src)) pass(`${f} imports the shared ad-spend module`)
  else { fail(`${f} reads Meta spend but does not import ../shared/adSpend.js`); unguarded++ }
}

// ── 5: the shared module still has what everyone relies on ──────────────────
const sharedPath = join(rootDir, SHARED)
if (!existsSync(sharedPath)) {
  fail(`${SHARED} is missing`)
} else {
  const s = readFileSync(sharedPath, 'utf8')
  for (const needle of [
    /export const EXCLUDED_FROM_WIX_BLENDED\s*=\s*\[\s*'cogni'\s*\]/,
    /\[\/\^cogni\(\?:\[-\\s\]\|\$\)\/i,\s*'cogni'\]/,
    /export function splitAdSpend\b/,
    /export function splitAdSpendByDay\b/,
    /export function adScopeOf\b/,
    /export function isExcludedFromWixBlended\b/,
  ]) {
    if (needle.test(s)) pass(`${SHARED} has ${needle.source.slice(0, 60)}`)
    else fail(`${SHARED} lost ${needle.source}`)
  }
}

// ── 6: the creative alarms (CTR, frequency, click→checkout) ──────────────────
// Their thresholds were measured on PP, so they read only campaigns that have
// thresholds. The filter sits INSIDE each exported alarm, not in a caller, so a
// direct call and evaluateAlerts() cannot disagree and no new caller can feed
// them Cogni rows. Scope comes from adSpend.js; alertRules.js names no campaign.
{
  const alertsSrc = readFileSync(join(rootDir, 'netlify/shared/alertRules.js'), 'utf8')
  if (/import\s*\{[^}]*\bcreativeAlarmRows\b[^}]*\}\s*from\s*['"]\.\/adSpend\.js['"]/.test(alertsSrc)) {
    pass('alertRules.js takes creativeAlarmRows from the shared ad-spend module')
  } else {
    fail('alertRules.js does not import creativeAlarmRows from ./adSpend.js')
  }
  for (const [fn, rule] of [
    ['creativeCtrAlert', 'KREACJA_CTR'],
    ['frequencyAlert', 'CZĘSTOTLIWOŚĆ'],
    ['clickToCheckoutAlert', 'KLIK_DO_KASY'],
  ]) {
    const re = new RegExp(`export function ${fn}\\(adDays\\)\\s*\\{\\s*return onCreativeScopes\\('${rule}'`)
    if (re.test(alertsSrc)) pass(`${fn} reads its rows only through the scope filter`)
    else fail(`${fn} in alertRules.js is not wrapped in onCreativeScopes() — it could read Cogni rows`)
  }
  // The un-filtered inner functions must stay private.
  if (/export\s+function\s+(?:creativeCtrOn|frequencyOn|clickToCheckoutOn)\b/.test(alertsSrc)) {
    fail('an un-filtered creative alarm is exported from alertRules.js')
  } else {
    pass('the un-filtered creative alarm functions are not exported')
  }
  const sharedSrc = readFileSync(join(rootDir, SHARED), 'utf8')
  for (const needle of [/export const CREATIVE_ALARM_EXCLUDED_SCOPES\b/, /export function creativeAlarmRows\b/, /export const CREATIVE_ALARM_NOTE\b/]) {
    if (needle.test(sharedSrc)) pass(`${SHARED} has ${needle.source}`)
    else fail(`${SHARED} lost ${needle.source}`)
  }
  // Nobody else may call the alarms with ad-day rows except through evaluateAlerts
  // or the alarm functions themselves — and none of them filters by hand.
  let handFiltered = 0
  for (const f of files) {
    const src = readFileSync(join(rootDir, f), 'utf8')
    if (!/\b(?:creativeCtrAlert|frequencyAlert|clickToCheckoutAlert|evaluateAlerts)\b/.test(src)) continue
    for (const [n, line] of code(src)) {
      if (/adDays\s*:.*\.filter\(.*(?:campaign_name|ad_name)/.test(line)) {
        fail(`${f}:${n} filters creative-alarm rows by campaign by hand: ${line.trim()}`); handFiltered++
      }
    }
  }
  if (handFiltered === 0) pass('no caller filters creative-alarm rows by campaign itself')
}

// The browser's one overlay must go through applySpendSplit().
const dataTs = readFileSync(join(rootDir, 'src/services/data.ts'), 'utf8')
if (/applySpendSplit\(rows, days\)/.test(dataTs)) pass('src/services/data.ts overlays the split through applySpendSplit()')
else fail('src/services/data.ts does not use applySpendSplit() for withSpendSplit()')
const harness = readFileSync(join(rootDir, 'scripts/_reportHarness.ts'), 'utf8')
if (/applySpendSplit\(rows, days\)/.test(harness)) pass('scripts/_reportHarness.ts overlays the split through applySpendSplit()')
else fail('scripts/_reportHarness.ts does not apply the spend split')

if (errors > 0) {
  console.error(`\nFAIL — ${errors} problem(s): the blended-spend rule is no longer in one place.`)
  process.exit(1)
}
console.log('\nPASS — the blended-spend rule lives only in netlify/shared/adSpend.js.')
