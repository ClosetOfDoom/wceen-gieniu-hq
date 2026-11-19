#!/usr/bin/env node
// Imports the last SENT webinar campaigns from Wix as templates into webinar-mails/tuesday|thursday/.
//
//   node scripts/import-webinar-templates.mjs [--env .env.local] [--limit 60] [--write]
//
// Without --write it only lists what it would do. Only campaigns built in the HTML editor are
// imported (their markup is what we wrote ourselves; MJML / drag-and-drop output is Wix-generated
// and is left alone). Wix Preview → templates: tracking links unwrapped, Wix footer stripped,
// the registration link replaced by {{WEBINAR_URL}}, subject in <title>, preheader in <meta>.
// Existing files are never overwritten. Credentials come from WIX_API_KEY / WIX_SITE_ID
// (process env or the .env file given with --env); they are never printed.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWixClient } from '../netlify/shared/webinarMailWix.js'
import { importTemplate, slugify } from '../netlify/shared/webinarMailImport.js'
import { validateTemplate } from '../netlify/shared/webinarMail.js'
import { WEBINAR_MAIL_CONFIG } from '../netlify/shared/webinarMailConfig.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const envFile = opt('--env', join(root, '.env.local'))
const env = { ...process.env }
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim()
  }
}
const wix = createWixClient({ apiKey: env.WIX_API_KEY, siteId: env.WIX_SITE_ID })

const campaigns = await wix.listRecentCampaigns({ limit: Number(opt('--limit', 60)) })
const sent = campaigns.filter((c) => c.distributionStatus === 'DISTRIBUTED' && c.datePublished)
const bySlot = { tuesday: [], thursday: [] }
const skipped = []

for (const c of sent) {
  if (c.editorType !== 'HTML') { skipped.push({ c, why: `edytor ${c.editorType}` }); continue }
  const preview = await wix.previewCampaign(c.campaignId)
  const subject = (preview.emailSubject || c.emailSubject || '').trim()
  const imp = importTemplate({ html: preview.html, subject })
  if (!imp.slot) { skipped.push({ c, why: 'nie jest mailem webinarowym' }); continue }
  bySlot[imp.slot].push({ c, subject, html: imp.html })
}

let written = 0
for (const slot of Object.keys(bySlot)) {
  const dir = join(root, WEBINAR_MAIL_CONFIG.slots[slot].dir)
  // Oldest first: the queue replays the mails in the order they were first sent.
  const rows = bySlot[slot].sort((a, b) => a.c.datePublished.localeCompare(b.c.datePublished))
  console.log(`\n${WEBINAR_MAIL_CONFIG.slots[slot].label}: ${rows.length} kampanii`)
  rows.forEach((r, i) => {
    const file = `${String(i + 1).padStart(2, '0')}-${r.c.datePublished.slice(0, 10)}-${slugify(r.subject)}.html`
    const v = validateTemplate(file, r.html)
    const verdict = v.blocked.length ? `ZABLOKOWANY (${v.blocked.join('; ')})` : v.warnings.length ? `ostrzeżenie (${v.warnings.join('; ')})` : 'ok'
    console.log(`  ${file}  [${verdict}]`)
    if (flag('--write')) {
      const target = join(dir, file)
      if (existsSync(target)) { console.log('    istnieje, pomijam'); return }
      mkdirSync(dir, { recursive: true })
      writeFileSync(target, r.html, 'utf8')
      written++
    }
  })
}
console.log(`\nPominięte: ${skipped.length} (${[...new Set(skipped.map((s) => s.why))].join(', ')})`)
console.log(flag('--write') ? `Zapisano plików: ${written}` : 'Tryb podglądu (bez --write): nic nie zapisano.')
