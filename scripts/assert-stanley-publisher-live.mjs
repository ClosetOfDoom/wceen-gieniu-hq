#!/usr/bin/env node
// Live check of the reel Publisher path in Stanley, against the DEPLOYED gateway (needs the shared password).
//
//   $env:STANLEY_ACCESS_TOKEN = "<the password>"          (PowerShell; the value is never printed)
//   npm run assert:stanley-publisher-live [-- https://elegant-kelpie-6fdfc8.netlify.app]
//
//   1. asks "what's the reel plan for next week?" and prints Stanley's answer (real dates and words from the Publisher);
//   2. asks for a move PREVIEW ("move <word> to Friday 19:00") of the first reel that is still fully scheduled.
//      The answer must show Before → After and wait for a "yes". This script NEVER sends the "yes": nothing is changed.
// Exit 1 when the plan answer has no reel table or the preview does not show Before → After / the confirmation line.

import { stanleyHeaders, explainAuth } from './_stanleyHeaders.mjs'

const base = (process.argv[2] ?? 'https://elegant-kelpie-6fdfc8.netlify.app').replace(/\/+$/, '')
let failures = 0
const fail = (m) => { console.error('  FAIL', m); failures++ }
const pass = (m) => console.log('  pass', m)

async function ask(message, pendingPublisher = null) {
  const res = await fetch(`${base}/.netlify/functions/gieniu-command`, {
    method: 'POST',
    headers: stanleyHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ message, context: { pendingPublisher } }),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`gieniu-command ${res.status}${explainAuth(res.status)}`)
  return res.json()
}

try {
  console.log('1. "what\'s the reel plan for next week?"')
  const plan = await ask("what's the reel plan for next week?")
  console.log(plan.answerText.split('\n').map((l) => '   ' + l).join('\n'))
  console.log('   [speech]', plan.speechText)
  if (plan.intent === 'publisher') pass('answered by the Publisher path (intent publisher)'); else fail(`intent was ${plan.intent}`)
  if (/^Reel plan, next week \(\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, Warsaw time\)/m.test(plan.answerText) || /No reels are scheduled between/.test(plan.answerText) || /I don't have that data — Publisher API returned/.test(plan.answerText)) pass('server-printed plan (or an explicit "no data" line)')
  else fail('no plan table in the answer')
  if (/Queue runs until \d{4}-\d{2}-\d{2}\./.test(plan.answerText)) pass('"Queue runs until <date>" present'); else console.log('  note  no "Queue runs until" line (status may be unavailable)')

  const target = plan.answerText.split('\n').find((l) => l.includes('FB: scheduled') && l.includes('IG: scheduled') && l.includes('YT: scheduled'))
  const word = target ? /· ([^\s(]+) \(/.exec(target)?.[1] : null
  console.log(`\n2. move PREVIEW of ${word ?? '(no fully scheduled reel next week)'}`)
  if (!word) {
    console.log('   skipped: no reel with all platforms scheduled in the plan above')
  } else {
    const prev = await ask(`move ${word} to Friday 19:00`)
    console.log(prev.answerText.split('\n').map((l) => '   ' + l).join('\n'))
    if (/Before → After:/.test(prev.answerText) && /→/.test(prev.answerText)) pass('Before → After shown'); else fail('no Before → After in the preview')
    if (/Say "yes" to make this change/.test(prev.answerText) && prev.pendingPublisher) pass('waits for "yes" (signed token returned); "yes" was NOT sent, nothing changed')
    else if (/Publisher refused:/.test(prev.answerText)) pass('the Publisher refused the preview and Stanley said why')
    else fail('no confirmation request and no refusal')
  }
} catch (e) {
  console.error('  FAIL', e.message)
  failures++
}
console.log(failures ? `\n${failures} problem(s)` : '\nall good')
process.exitCode = failures ? 1 : 0
