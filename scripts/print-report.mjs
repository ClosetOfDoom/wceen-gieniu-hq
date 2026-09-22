#!/usr/bin/env node
// Prints the clipboard report for real, from live data, for the ranges given.
//
// The COPY button's output is only trustworthy if somebody has actually looked
// at it next to the dashboard. This bundles the real frontend modules with
// esbuild — buildReport, resolveRangePerf, the goal helpers, the format helpers
// — so what it prints is what the button puts on the clipboard, not a rehearsal
// of it.
//
//   npm run report                 # today, week, month
//   npm run report -- week         # one range
//
// Needs VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (read from .env if unset).

import { build } from 'esbuild'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

// ── env ──────────────────────────────────────────────────────────────────────
const envFile = join(rootDir, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
  console.error('FAIL — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not available (checked env and .env)')
  process.exit(1)
}
process.env.BUILD_HASH ??= (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: rootDir }).toString().trim() }
  catch { return 'dev' }
})()

// ── bundle the real modules ──────────────────────────────────────────────────
const outDir = mkdtempSync(join(tmpdir(), 'stanley-report-'))
const outFile = join(outDir, 'harness.mjs')

await build({
  entryPoints: [join(rootDir, 'scripts/_reportHarness.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
})

try {
  const { runForRange } = await import(pathToFileURL(outFile).href)

  const requested = process.argv.slice(2).filter(a => !a.startsWith('-'))
  const ranges = requested.length > 0 ? requested : ['today', 'week', 'month']

  for (const range of ranges) {
    const { report, comparison } = await runForRange(range)
    console.log('\n' + '='.repeat(86))
    console.log(`RAPORT — ${range.toUpperCase()}`)
    console.log('='.repeat(86))
    console.log(report)
    console.log('-'.repeat(86))
    console.log('PORÓWNANIE: karta vs raport')
    console.log('-'.repeat(86))
    console.log(comparison)
  }
} finally {
  rmSync(outDir, { recursive: true, force: true })
}
