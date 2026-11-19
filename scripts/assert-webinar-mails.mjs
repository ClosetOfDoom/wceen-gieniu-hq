#!/usr/bin/env node
// Structural check of the webinar mail templates and wiring (webinar-mails/<slot>/*.html).
//
//   node scripts/assert-webinar-mails.mjs
//
// FAILS on: a missing slot folder, a template without <title>, without {{WEBINAR_URL}}, with a tracking
// link of an old Wix campaign, with the Wix-injected footer; duplicate numeric prefixes; a cron that
// differs between the function file and the config; functions.included_files missing in netlify.toml.
// A template the SUBJECT VALIDATOR blocks ("!", merge tags, prices) is not a failure here: the queue
// skips it and the tab lists it with the reason. It is printed as INFO.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEBINAR_MAIL_CONFIG as CFG } from '../netlify/shared/webinarMailConfig.js'
import { validateTemplate, buildQueue } from '../netlify/shared/webinarMail.js'

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
    const soft = v.blocked.filter((b) => !hard.includes(b))
    if (soft.length) info(`${s.dir}/${t.file}: blocked by the subject validator (${soft.join('; ')}), the queue skips it`)
  }
  if (!structural) ok(`${s.dir}/: ${files.length} templates, all structurally sound`)
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
if (/withStanleyAuth\(/.test(admin)) ok('webinar-mail-admin is behind the shared password')
else fail('webinar-mail-admin is not wrapped in withStanleyAuth')
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
if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(CFG.testContactId)) ok(`test contact configured (${CFG.testRecipient})`)
else fail('WEBINAR_MAIL_CONFIG.testContactId is missing or not a GUID')

console.log(errors ? `\n${errors} problem(s)` : '\nall good')
process.exit(errors ? 1 : 0)
