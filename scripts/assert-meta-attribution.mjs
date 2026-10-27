#!/usr/bin/env node
// Nothing may divide by meta_purchases, and the withdrawn claim may not return.
//
// Measured 2026-10-27: Business Manager reports 46 purchases for PP-22.06.2026
// over 2026-10-20…26; meta_ads_daily holds 5, all on the final day. A CPA
// computed from that read 1 762,25 PLN against a real Wix CPA near 40 — and
// drew it in red, which this dashboard reserves for things somebody should act
// on. That is not an under-reported metric, it is an artefact of the divisor.
//
// These are source checks rather than unit tests because they are about what
// the code does NOT contain, and because they read files — which the browser
// test environment has no business doing.

import { readFileSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root
const read = (p) => readFileSync(join(rootDir, p), 'utf8')

let errors = 0
const pass = (m) => console.log(`  pass ${m}`)
const fail = (m) => { console.log(`  FAIL ${m}`); errors++ }

console.log('Meta attribution discipline')
console.log('')

const inspector = read('src/components/CampaignInspector.tsx')

if (!/spend\s*\/\s*current\.purchases/.test(inspector)) {
  pass('CampaignInspector computes no CPA from meta_purchases')
} else {
  fail('CampaignInspector divides spend by meta_purchases again')
}
if (!/current\.value\s*\/\s*current\.spend/.test(inspector)) {
  pass('CampaignInspector computes no ROAS from Meta purchase value')
} else {
  fail('CampaignInspector divides Meta purchase value by spend again')
}
for (const card of ['label="CPA (Meta)"', 'label="ROAS (Meta)"']) {
  if (!inspector.includes(card)) pass(`the ${card} card is gone`)
  else fail(`${card} is back — see META_PURCHASES_FIXED_ON before restoring it`)
}
if (inspector.includes('label="Purchases"') && inspector.includes('nie łączy się z zamówieniami Wix')) {
  pass('Purchases stays, labelled as Meta-reported and not joinable to Wix')
} else {
  fail('Purchases must stay, with its provenance on the card')
}

// The claim that was never tested, and that the zeros did not support.
const RETIRED = [
  ['src/lib/exportReport.ts', 'Meta zaniża konwersje'],
  ['src/components/CampaignsPanel.tsx', 'zaniża konwersje Meta'],
]
for (const [file, phrase] of RETIRED) {
  if (!read(file).includes(phrase)) pass(`${file}: "${phrase}" withdrawn`)
  else fail(`${file} still claims "${phrase}" — the gap was in our ingest, not in Meta`)
}

// The section exists and is off. Both halves matter: off with nothing built is
// a promise, built and on is a panel of wrong numbers.
const ow = read('src/lib/orderWindow.ts')
if (/META_WORLD_ACTIVE\s*=\s*false/.test(ow)) {
  pass('META_WORLD_ACTIVE is false while the ingest is broken')
  const app = read('src/App.tsx')
  if (/META_WORLD_ACTIVE\s*&&/.test(app)) pass('App.tsx renders ŚWIAT META only behind the flag')
  else fail('App.tsx must gate MetaWorldPanel on META_WORLD_ACTIVE')
} else {
  pass('META_WORLD_ACTIVE is true — somebody verified the ingest deliberately')
}
if (/META_PURCHASES_FIXED_ON[^\n]*=\s*null/.test(ow)) {
  pass('META_PURCHASES_FIXED_ON is null — every period reads as NIEPOBIERANE')
} else {
  pass('META_PURCHASES_FIXED_ON is set — periods from that day count as collected')
}

console.log('')
if (errors > 0) {
  console.error(`FAIL — ${errors} Meta attribution violation(s).`)
  process.exit(1)
}
console.log('PASS — no metric is computed from meta_purchases, and the old claim is gone.')
