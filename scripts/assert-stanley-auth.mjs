#!/usr/bin/env node
// Static check of the shared password (x-stanley-token):
//  1. every function in netlify/functions that exports a handler goes through withStanleyAuth()
//     (v1) or withStanleyAuthV2() (v2, export default), and none of them sets a wildcard CORS origin.
//     Exceptions, by name only: scheduled functions (config.schedule, not callable over HTTP) and the
//     PUBLIC read-only health endpoints listed below;
//  2. nothing in src/ calls /.netlify/functions/* with plain fetch() — only src/lib/stanleyAuth.ts
//     (the wrapper itself and the password check) may.
// Prints the grep-style result it bases the verdict on. No secrets involved.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
let errors = 0
const fail = (m) => { console.log(`  FAIL ${m}`); errors++ }
const pass = (m) => console.log(`  pass ${m}`)

console.log('\n== netlify/functions')
const fnDir = join(root, 'netlify', 'functions')
// Public on purpose: GET only, read only, no template content, campaign IDs, e-mails or secrets (see the file header).
const PUBLIC = new Set(['webinar-mail-health.js'])
for (const f of readdirSync(fnDir).filter((n) => n.endsWith('.js')).sort()) {
  const s = readFileSync(join(fnDir, f), 'utf8')
  const v1 = /export (const|async function) handler\b/.test(s)
  const v2 = /export default\b/.test(s)
  if (!v1 && !v2) { console.log(`  skip ${f} (helper, not a function)`); continue }
  if (v2 && /export const config = \{ schedule:/.test(s)) { pass(`${f}: scheduled function (v2), not callable over HTTP`); continue }
  if (v2 && PUBLIC.has(f)) {
    if (/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(s)) fail(`${f}: wildcard CORS origin`)
    else pass(`${f}: PUBLIC read-only endpoint (v2), on the allow-list`)
    continue
  }
  if (v2 && !/export default withStanleyAuthV2\(/.test(s)) fail(`${f}: v2 function is not wrapped in withStanleyAuthV2`)
  else if (v1 && !/export const handler = withStanleyAuth\(/.test(s)) fail(`${f}: handler is not wrapped in withStanleyAuth`)
  else if (/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(s)) fail(`${f}: wildcard CORS origin`)
  else pass(`${f}: ${v2 ? 'withStanleyAuthV2 (v2)' : 'withStanleyAuth'}, no wildcard CORS`)
}

console.log('\n== src: calls to /.netlify/functions/*')
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === '__tests__' ? [] : walk(join(d, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : [])
let via = 0
for (const file of walk(join(root, 'src'))) {
  const rel = file.slice(root.length + 1).split('\\').join('/')
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const mentionsFn = lines.some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && l.includes('.netlify/functions'))
  const raw = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /(^|[^A-Za-z_.])fetch\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
  const wrapped = lines.filter((l) => /stanleyFetch\(/.test(l)).length
  via += wrapped
  if (rel === 'src/lib/stanleyAuth.ts') { console.log(`  info ${rel}: wrapper + password check (${raw.length} raw fetch, by design)`); continue }
  if (mentionsFn && raw.length) fail(`${rel}: plain fetch() in a file that calls a function (line ${raw.map(([n]) => n).join(', ')})`)
  else if (raw.length) console.log(`  info ${rel}: plain fetch() to external service only (line ${raw.map(([n]) => n).join(', ')})`)
  if (wrapped) pass(`${rel}: ${wrapped} call(s) via stanleyFetch`)
}
if (via === 0) fail('no stanleyFetch callers found')
console.log(`\nstanley-auth: ${errors === 0 ? 'OK' : errors + ' FAIL'}`)
process.exit(errors === 0 ? 0 : 1)
