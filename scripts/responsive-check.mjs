#!/usr/bin/env node
// Responsive check of the PRODUCTION build (dist/, served by `vite preview`) with Playwright.
//
//   npm run build && node scripts/responsive-check.mjs [screenshotDir]
//
// For widths 360 and 390 px and every tab of the bottom bar (HOME, CAMPAIGNS, WEBINARS, MAILE, STATUS):
//   · document.documentElement.scrollWidth <= window.innerWidth   (no horizontal scroll)
//   · the "Wyloguj" button is visible and fully inside the viewport
//   · the header date is not cut (its box fits and its text does not overflow)
//   · every bottom-bar label fits its cell (no clipping) and the bar has exactly 5 tabs
// The app is entered with a dummy password in localStorage; calls to /.netlify/functions/* are answered with 503
// (no secrets locally), so panels show their "no data" state. Browser: the installed Microsoft Edge (channel msedge),
// or Playwright's Chromium when PW_CHANNEL=chromium. Screenshots go to the given directory (default: OS temp).
// Prints one JSON line per tab × width and a table; exits 1 on any failure.

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = process.argv[2] || path.join(tmpdir(), 'stanley-responsive')
mkdirSync(shots, { recursive: true })
const PORT = 4179
const BASE = `http://127.0.0.1:${PORT}`
const TABS = ['Home', 'Campaigns', 'Webinars', 'Maile', 'Status']
const WIDTHS = [360, 390]

const preview = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const stop = () => { try { preview.kill() } catch { /* already gone */ } }
process.on('exit', stop)

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE)).ok) return } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('vite preview did not start')
}

let failures = 0
const results = []
try {
  await waitForServer()
  const channel = process.env.PW_CHANNEL === 'chromium' ? undefined : (process.env.PW_CHANNEL || 'msedge')
  const browser = await chromium.launch({ channel })
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block', deviceScaleFactor: 1 })
    await context.addInitScript(() => { try { localStorage.setItem('stanley.access.token', 'responsive-check-dummy') } catch { /* ignore */ } })
    await context.route('**/.netlify/functions/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"responsive-check: no backend"}' }))
    const page = await context.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.mobile-nav', { timeout: 20000 })
    for (const tab of TABS) {
      await page.locator('.mobile-nav-item', { hasText: tab }).first().click()
      await page.waitForTimeout(1200)
      const m = await page.evaluate(() => {
        const inView = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth + 0.5 }
        const logout = document.querySelector('[data-testid="logout"]')
        const lr = logout?.getBoundingClientRect()
        const date = document.querySelector('[data-testid="topbar-date"]')
        const labels = [...document.querySelectorAll('.mobile-nav-label')]
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          logoutVisible: !!logout && inView(logout) && getComputedStyle(logout).visibility !== 'hidden' && !!lr && lr.height > 0,
          dateOk: !!date && inView(date) && date.scrollWidth <= date.clientWidth + 0.5,
          navTabs: labels.length,
          navLabelsOk: labels.every((l) => l.scrollWidth <= l.clientWidth + 0.5 && inView(l)),
          navLabels: labels.map((l) => l.textContent),
        }
      })
      await page.screenshot({ path: path.join(shots, `${width}-${tab.toLowerCase()}.png`), fullPage: false })
      const ok = m.scrollWidth <= m.innerWidth && m.logoutVisible && m.dateOk && m.navTabs === 5 && m.navLabelsOk
      if (!ok) failures++
      const row = { tab: tab.toUpperCase(), width, ...m, ok }
      results.push(row)
      console.log(JSON.stringify(row))
    }
    await context.close()
  }
  await browser.close()
} finally {
  stop()
}

console.log('\n| zakładka | szerokość | scrollWidth | innerWidth | Wyloguj widoczny | data cała | 5 zakładek bez ucięcia | wynik |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const r of results) console.log(`| ${r.tab} | ${r.width} | ${r.scrollWidth} | ${r.innerWidth} | ${r.logoutVisible ? 'tak' : 'NIE'} | ${r.dateOk ? 'tak' : 'NIE'} | ${r.navTabs === 5 && r.navLabelsOk ? 'tak' : 'NIE'} | ${r.ok ? 'OK' : 'FAIL'} |`)
console.log(`\nscreenshots: ${shots}`)
console.log(failures ? `\nresponsive-check: ${failures} FAIL` : '\nresponsive-check: OK')
process.exit(failures ? 1 : 0)
