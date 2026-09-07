#!/usr/bin/env node
// Static guard for the CLASS of bug that produced "Est. Profit = −(ad spend)".
//
// PostgREST caps every response at 1000 rows. The cap is SILENT: ask for
// limit=5000 and you get 1000 rows and a 200 OK — and with no ORDER BY, the
// 1000 you get are in physical table order, i.e. the OLDEST. Two functions read
// `orders` that way; once the table passed 1000 rows, every newer order became
// invisible and margin was summed over an empty set.
//
// Eleven other reads across the repo had the same shape. So this file does not
// check one call site: it checks that no read can be written that way again.
//
//   npm run assert:data-source-reads

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
const fail = (m) => { console.error('  FAIL', m); errors++ }
const pass = (m) => console.log('  pass', m)
const read = (rel) => readFileSync(join(rootDir, rel), 'utf8')
const exists = (rel) => existsSync(join(rootDir, rel))

const CAP = 1000

console.log('Supabase read discipline\n')

// ── 1. The one server-side reader ────────────────────────────────────────────
{
  const f = 'netlify/shared/supabaseRead.js'
  if (!exists(f)) {
    fail(`${f} is missing — it is the ONE way a Netlify Function may read Supabase`)
  } else {
    const c = read(f)
    if (c.includes(`export const PAGE = ${CAP}`)) {
      pass(`supabaseRead.js: knows the ${CAP}-row cap explicitly`)
    } else {
      fail(`supabaseRead.js: must declare PAGE = ${CAP}, the PostgREST cap it pages around`)
    }
    if (c.includes('is required. Without ORDER BY')) {
      pass('supabaseRead.js: a read with no `order` is REFUSED at call time, not silently capped')
    } else {
      fail('supabaseRead.js: readTable must throw when `order` is missing')
    }
    if (c.includes('offset:') && c.includes('rows.length < pageSize')) {
      pass('supabaseRead.js: pages until a SHORT page arrives (a full page might be the cap)')
    } else {
      fail('supabaseRead.js: must keep paging while pages come back full')
    }
  }
}

// ── 2. No function builds its own request ────────────────────────────────────
{
  const dir = join(rootDir, 'netlify/functions')
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))

  const raw = files.filter(f => read(`netlify/functions/${f}`).includes('/rest/v1/'))
  if (raw.length === 0) {
    pass('no function builds a /rest/v1 request of its own')
  } else {
    fail(`these functions bypass supabaseRead.js with a raw /rest/v1 fetch: ${raw.join(', ')}`)
  }

  // A limit above the cap is a promise the database will not keep. Only the
  // shared reader may name a number that large, and only to page with it.
  for (const f of files) {
    const c = read(`netlify/functions/${f}`)
    for (const m of c.matchAll(/limit:\s*'?(\d+)'?/g)) {
      const n = Number(m[1])
      if (n > CAP) {
        fail(`netlify/functions/${f}: limit ${n} is above the ${CAP}-row cap — it will silently return ${CAP}`)
      }
    }
  }
  if (errors === 0 || !files.some(f => /limit:\s*'?\d{4,}'?/.test(read(`netlify/functions/${f}`)))) {
    pass(`no function asks for more than ${CAP} rows in one request`)
  }

  // Netlify treats every file in the functions directory as a function. A .d.ts
  // there is bundled as one and fails the build with
  // "The constant PRODUCTS must be initialized" — which is how three deploys
  // died before this guard existed. Shared library code lives in netlify/shared.
  const stray = readdirSync(dir).filter(f => f.endsWith('.d.ts'))
  if (stray.length === 0) {
    pass('no .d.ts in netlify/functions (Netlify would bundle it as a function and fail the build)')
  } else {
    fail(`.d.ts in netlify/functions breaks the Netlify build: ${stray.join(', ')} — move it to netlify/shared`)
  }
}

// ── 3. The browser side ──────────────────────────────────────────────────────
// The frontend reads through supabase-js with the RLS-limited anon key, so it
// cannot share the server module. It gets the same rule from its own helper.
{
  const f = 'src/services/supabase.ts'
  const c = read(f)
  if (c.includes('export async function pagedSelect')) {
    pass('supabase.ts: exports pagedSelect — the browser-side paged, ordered read')
  } else {
    fail('supabase.ts: must export pagedSelect for the same reason the functions have readTable')
  }
  if (c.includes('order: { column: string')) {
    pass('supabase.ts: pagedSelect requires an order column (not optional)')
  } else {
    fail('supabase.ts: pagedSelect must take `order` as a REQUIRED field')
  }
  if (c.includes('error: string | null')) {
    pass('supabase.ts: pagedSelect RETURNS the error instead of logging it away')
  } else {
    fail('supabase.ts: pagedSelect must return the error so a panel can say it cannot read')
  }

  // .limit(1000) anywhere in src is the cap by another name: it cannot be
  // distinguished from a truncated response.
  const srcFiles = []
  const walk = (rel) => {
    for (const e of readdirSync(join(rootDir, rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`)
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) srcFiles.push(`${rel}/${e.name}`)
    }
  }
  walk('src')

  const offenders = []
  for (const rel of srcFiles) {
    const c2 = read(rel)
    if (rel.includes('__tests__')) continue
    for (const m of c2.matchAll(/\.limit\(\s*(\d+)\s*\)/g)) {
      if (Number(m[1]) >= CAP) offenders.push(`${rel}: .limit(${m[1]})`)
    }
  }
  if (offenders.length === 0) {
    pass(`no src read uses .limit(>= ${CAP}) — that value is indistinguishable from a truncated response`)
  } else {
    fail(`these reads sit on or above the cap; use pagedSelect instead:\n      ${offenders.join('\n      ')}`)
  }
}

// ── 4. Orders specifically ───────────────────────────────────────────────────
// `orders` is the table that broke. It is already past the cap, and it grows
// every day, so every read of it must go through the catalog's range helpers.
{
  const dir = join(rootDir, 'netlify/functions')
  const offenders = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const c = read(`netlify/functions/${f}`)
    // A read naming the orders table without either catalog helper.
    const readsOrders = /'orders'/.test(c)
    const viaCatalog = c.includes('fetchOrdersInRange') || c.includes('fetchAllOrders')
    const viaReader = c.includes('readTable')
    if (readsOrders && !viaCatalog && !viaReader) offenders.push(f)
  }
  if (offenders.length === 0) {
    pass('every function that touches `orders` reads it through the shared helpers')
  } else {
    fail(`these read \`orders\` without the shared helpers: ${offenders.join(', ')}`)
  }
}

// ── 5. Every call site names an order column ─────────────────────────────────
// readTable throws when `order` is missing, so a read without one is a runtime
// 500, not a wrong number. Catching it here means it never reaches a deploy.
{
  const dir = join(rootDir, 'netlify/functions')
  const CALLERS = /(readTable|queryTable|supabaseGet|tryGet|tryReadTable)\s*\(/g
  const offenders = []

  for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const c = read(`netlify/functions/${f}`)
    for (const m of c.matchAll(CALLERS)) {
      // Walk from the call's opening paren to its match, tracking depth, so the
      // options object is read whole rather than by a fragile regex.
      let i = m.index + m[0].length - 1
      let depth = 0
      let end = -1
      for (; i < c.length; i++) {
        if (c[i] === '(') depth++
        else if (c[i] === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      if (end < 0) continue
      const args = c.slice(m.index + m[0].length, end)
      // Only call sites that pass an inline options object can be judged here;
      // a forwarded `params` variable is checked at its own call site.
      if (!args.includes('{')) continue
      if (!/select\s*:/.test(args)) continue
      if (!/order\s*:/.test(args)) {
        const where = c.slice(0, m.index).split(String.fromCharCode(10)).length
        offenders.push(`netlify/functions/${f}:${where} ${m[1]}(...) has select but no order`)
      }
    }
  }
  if (offenders.length === 0) {
    pass('every inline read passes an explicit order column')
  } else {
    fail('these reads would throw at runtime (readTable refuses a read with no order): '
       + offenders.join('; '))
  }
}

console.log('')
if (errors > 0) {
  console.error(`FAIL — ${errors} Supabase read violation(s).`)
  process.exit(1)
}
console.log('PASS — every Supabase read is ordered and paged.')
