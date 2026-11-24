#!/usr/bin/env node
// Structural check of the webinar mail templates and wiring (webinar-mails/<slot>/*.html).
//
//   node scripts/assert-webinar-mails.mjs
//
// FAILS on: a missing slot folder, a template without <title>, without {{WEBINAR_URL}}, with a tracking
// link of an old Wix campaign, with the Wix-injected footer; duplicate numeric prefixes; a cron that
// differs between the function file and the config; functions.included_files missing in netlify.toml;
// {{unsubscribe}} in any template; a READY template whose final HTML still has {{...}} / ${...}.
// A template the VALIDATOR blocks (subject: "!", merge tags, prices; body: tags left after the render, e.g.
// ${contact.name.first}) is not a failure here: the queue skips it and the tab lists it with the reason (INFO).

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEBINAR_MAIL_CONFIG as CFG } from '../netlify/shared/webinarMailConfig.js'
import { validateTemplate, buildQueue, renderCampaignHtml } from '../netlify/shared/webinarMail.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let errors = 0
const ok = (m) => console.log('  pass', m)
const fail = (m) => { console.error('  FAIL', m); errors++ }
const info = (m) => console.log('  info', m)

for (const [slot, s] of Object.entries(CFG.slots)) {
  const dir = join(root, s.dir)
  if (!existsSync(dir)) { fail(`${s.dir}/ does not exist`); continue }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.html')).sort()
  if (files.length === 0) { fail(`${s.dir}/ has no templates`); continue }
  const prefixes = files.map((f) => f.split('-')[0])
  if (new Set(prefixes).size !== prefixes.length) fail(`${s.dir}/ has duplicate numeric prefixes`)
  const templates = files.map((file) => ({ file, html: readFileSync(join(dir, file), 'utf8') }))
  let structural = 0
  for (const t of templates) {
    const v = validateTemplate(t.file, t.html)
    const hard = v.blocked.filter((b) => /WEBINAR_URL|śledzące|stopka/.test(b) || b === 'brak tematu')
    for (const h of hard) { fail(`${s.dir}/${t.file}: ${h}`); structural++ }
    // The own unsubscribe link is dead in an HTML campaign (Wix adds its own footer): it must not be in any template.
    if (t.html.includes('{{unsubscribe}}')) { fail(`${s.dir}/${t.file}: contains {{unsubscribe}} (dead link; Wix adds its own unsubscribe footer)`); structural++ }
    // Every template that the queue would use renders with no {{...}} / ${...} left (same render as the real send).
    const r = renderCampaignHtml(t.html, s.variants[Object.keys(s.variants)[0]])
    if (v.blocked.length === 0 && r.unresolved.length) { fail(`${s.dir}/${t.file}: ready but its final HTML keeps ${r.unresolved.join(', ')}`); structural++ }
    const soft = v.blocked.filter((b) => !hard.includes(b))
    if (soft.length) info(`${s.dir}/${t.file}: blocked by the validator (subject or leftover tags: ${soft.join('; ')}), the queue skips it`)
  }
  if (!structural) ok(`${s.dir}/: ${files.length} templates, all structurally sound, no {{unsubscribe}}, ready ones render without {{...}} / ${'${...}'}`)
  const q = buildQueue(slot, templates, [])
  ok(`${s.dir}/: ${q.readyCount} ready, ${q.blockedCount} blocked`)
}

const fn = readFileSync(join(root, 'netlify/functions/webinar-mail-run.js'), 'utf8')
if (fn.includes(`schedule: '${CFG.cron}'`)) ok(`cron in webinar-mail-run.js equals the config ('${CFG.cron}', 06:00 Warsaw in CET and CEST)`)
else fail(`cron in webinar-mail-run.js differs from WEBINAR_MAIL_CONFIG.cron ('${CFG.cron}')`)

const toml = readFileSync(join(root, 'netlify.toml'), 'utf8')
if (/included_files\s*=\s*\[[^\]]*webinar-mails\/\*\*/.test(toml)) ok('netlify.toml ships webinar-mails/** with the functions')
else fail('netlify.toml: [functions] included_files must contain "webinar-mails/**"')

const admin = readFileSync(join(root, 'netlify/functions/webinar-mail-admin.js'), 'utf8')
if (/export default withStanleyAuthV2\(/.test(admin)) ok('webinar-mail-admin is a v2 function behind the shared password')
else fail('webinar-mail-admin must be `export default withStanleyAuthV2(...)` (Blobs strong consistency needs v2)')

// One access path to Netlify Blobs: only webinarMailStore.js imports @netlify/blobs; every function using the store is v2.
const blobUsers = []
for (const dir of ['netlify/functions', 'netlify/shared']) {
  for (const f of readdirSync(join(root, dir))) {
    if (!/\.(js|mjs)$/.test(f)) continue
    const text = readFileSync(join(root, dir, f), 'utf8')
    if (/@netlify\/blobs|connectLambda|getStore\(/.test(text)) blobUsers.push(`${dir}/${f}`)
    if (dir === 'netlify/functions' && /createBlobStore\(/.test(text) && !/export default\b/.test(text)) fail(`${dir}/${f}: uses the Blobs store but is not a v2 function`)
  }
}
if (blobUsers.length === 1 && blobUsers[0] === 'netlify/shared/webinarMailStore.js') ok('Netlify Blobs only through webinarMailStore.js (no connectLambda, no other getStore)')
else fail(`Netlify Blobs must be reached only through netlify/shared/webinarMailStore.js; found in: ${blobUsers.join(', ')}`)
if (!/publishCampaign/.test(admin)) ok('webinar-mail-admin cannot publish to the audience (no publishCampaign call)')
else fail('webinar-mail-admin must not call publishCampaign')

// One publication path: production and "Wyślij test" both go through createAndPublish; Wix Send Test is not used.
const adminShared = readFileSync(join(root, 'netlify/shared/webinarMailAdmin.js'), 'utf8')
const core = readFileSync(join(root, 'netlify/shared/webinarMail.js'), 'utf8')
if (/createAndPublish\([^)]*test: true/.test(adminShared) && !/publishCampaign\(/.test(adminShared)) ok('"Wyślij test" goes through createAndPublish({ test: true }), never publishCampaign directly')
else fail('webinarMailAdmin.js: the test must use createAndPublish({ ..., test: true }) and nothing else')
if ((core.match(/wix\.publishCampaign\(/g) ?? []).length === 1 && /if \(test\) assertTestAudience\(/.test(core)) ok('exactly one wix.publishCampaign call in the code (inside createAndPublish, guarded for tests)')
else fail('webinarMail.js: wix.publishCampaign must be called only inside createAndPublish, after assertTestAudience for tests')
const sendTestUsers = []
for (const dir of ['netlify/functions', 'netlify/shared', 'src/services', 'src/components']) {
  for (const f of readdirSync(join(root, dir))) {
    if (!/\.(js|ts|tsx|mjs)$/.test(f)) continue
    const text = readFileSync(join(root, dir, f), 'utf8')
    if (/\/campaigns\/[^'"`]*\/test\b|\bsendTest\s*[:(]|toEmailAddress/.test(text)) sendTestUsers.push(`${dir}/${f}`)
  }
}
if (!sendTestUsers.length) ok('no Wix Send Test call anywhere in the functions or the app')
else fail(`Wix Send Test still used in: ${sendTestUsers.join(', ')}`)
// T1: one status list. The tab and the backend never compare send-log statuses by hand.
const panel = readFileSync(join(root, 'src/components/WebinarMailPanel.tsx'), 'utf8')
// log rows are e / r / row / entry; run outcomes (run.status, lastRun.status) are a different list
const literalStatus = /\b(?:e|r|row|entry)\.status\s*[!=]==?\s*['"](scheduled|failed|test|test-failed)['"]/
const handMapped = [['src/components/WebinarMailPanel.tsx', panel], ['netlify/shared/webinarMail.js', core], ['netlify/shared/webinarMailAdmin.js', adminShared]]
  .filter(([, text]) => literalStatus.test(text)).map(([f]) => f)
if (/from '\.\.\/\.\.\/netlify\/shared\/webinarMailStatus\.js'/.test(panel) && /sendStatusView\(/.test(panel) && !handMapped.length) ok('send-log statuses come from netlify/shared/webinarMailStatus.js only (panel uses sendStatusView)')
else fail(`send-log statuses mapped by hand outside webinarMailStatus.js: ${handMapped.join(', ') || 'panel does not use sendStatusView'}`)

// Production goes ONLY to the e-mail subscribers (2026-11-24): one selection in the config, guarded in createAndPublish.
const aud = CFG.audience ?? {}
if (aud.selection === 'subskrybenci-email' && !('labelIds' in aud) && !('segmentIds' in aud) && !JSON.stringify(aud).includes('contacts-all')
  && JSON.stringify(aud.contactsFilter) === JSON.stringify({ 'primaryEmail.subscriptionStatus': 'SUBSCRIBED' })) ok(`production recipients: ${aud.name} (no label, no segment, no contacts-all)`)
else fail('WEBINAR_MAIL_CONFIG.audience must be the e-mail subscribers selection only (no contacts-all, no label, no segment)')
if (/else assertProductionAudience\(audience, config\)/.test(core) && /resolveProductionAudience\(wix, config\)/.test(core) && /evaluateRecipients\(/.test(core)) ok('production publish guarded: assertProductionAudience + BEZPIECZNIK ODBIORCY in the run')
else fail('webinarMail.js: production publish must go through assertProductionAudience and the ODBIORCY check')
if (Number.isInteger(CFG.recipientsBaseline?.count) && CFG.recipientsBaseline.count > 0 && CFG.recipientsMaxGrowth > 1 && CFG.recipientsMaxGrowth <= 1.1) ok(`BEZPIECZNIK ODBIORCY: ≤ ${Math.round(CFG.recipientsMaxGrowth * 100)}% of the last count (baseline ${CFG.recipientsBaseline.count} from ${CFG.recipientsBaseline.at})`)
else fail('WEBINAR_MAIL_CONFIG.recipientsBaseline / recipientsMaxGrowth missing or out of range')

if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(CFG.testContactId)) ok(`test contact configured (${CFG.testRecipient})`)
else fail('WEBINAR_MAIL_CONFIG.testContactId is missing or not a GUID')

console.log(errors ? `\n${errors} problem(s)` : '\nall good')
process.exit(errors ? 1 : 0)
