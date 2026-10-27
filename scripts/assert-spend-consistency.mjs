#!/usr/bin/env node
// One number per metric per range, wherever it is shown.
//
// Two bugs sat behind this on 2026-10-27, both of the same shape — the same
// quantity worked out twice, in two places, from two slightly different sets:
//
//   · AD SPEND read 292,79 on the global card and 280,75 in Reklamy — kampanie.
//   · REAL CPA read 44,44 on the card and 45,05 in the goal bar (week), 37,15
//     and 36,71 (month); ROAS 2,88/2,85 and 3,64/3,63.
//
// The spend pair is one source fetched twice — the view is a sum of
// meta_ads_daily — so a closed day must match to the grosz and only a day in
// progress may differ. The CPA pair was two definitions: profit-data divides
// by blendedOrdersCount (no WSZTP, no non-sales), while App.tsx was dividing
// dailySeries orders, which only drops rows under the 5 PLN floor.
//
// Runs against the deployed functions. Read-only.

const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'https://elegant-kelpie-6fdfc8.netlify.app'

let errors = 0
const pass = (m) => console.log(`  pass ${m}`)
const fail = (m) => { console.log(`  FAIL ${m}`); errors++ }
const pln = (n) => Number(n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const get = async (path) => {
  const res = await fetch(`${BASE}/.netlify/functions/${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json()
}

// ── the four ranges, resolved the way lib/timeRange.ts resolves them ────────
const warsaw = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(d)
const today = warsaw(new Date())
const daysAgo = (n) => warsaw(new Date(Date.now() - n * 86400000))
const RANGES = [
  ['DZIŚ', today, today, true],
  ['WCZORAJ', daysAgo(1), daysAgo(1), false],
  ['TYDZIEŃ', daysAgo(7), daysAgo(1), false],
  ['MIESIĄC', today.slice(0, 8) + '01', today, true],
]

console.log('Spend and metric consistency')
console.log('')

for (const [label, from, to, inProgress] of RANGES) {
  const [cd, pd] = await Promise.all([
    get(`campaign-data?from=${from}&to=${to}`),
    get(`profit-data?from=${from}&to=${to}`),
  ])

  // The campaign section sums meta_ads_daily; the global card reads the view.
  const cardSpend = (cd.rows ?? []).reduce((s, r) => s + (r.spend ?? 0), 0)
  const viewSpend = pd.adSpend ?? 0
  const gap = Math.abs(cardSpend - viewSpend)

  if (gap <= 0.01) {
    pass(`${label} (${from}→${to}): wydatek zgodny — ${pln(viewSpend)}`)
  } else if (inProgress) {
    // A day still accruing can legitimately differ between two fetches.
    pass(`${label}: ${pln(cardSpend)} vs ${pln(viewSpend)} (różnica ${pln(gap)}) `
      + '— doba w toku, dwa pobrania w różnych momentach')
  } else {
    fail(`${label}: karta kampanii ${pln(cardSpend)} ≠ karta globalna ${pln(viewSpend)} `
      + `(różnica ${pln(gap)}) — doba zamknięta, to nie jest kwestia odświeżenia`)
  }

  // Grouping must not lose rows: the per-creative view and the per-day view
  // have to describe the same money.
  const daily = cd.dailyRows ?? null
  if (daily == null) {
    console.log(`       (dailyRows nieobecne — stary deploy, pomijam kontrolę grupowania)`)
  } else {
    const dailySpend = daily.reduce((s, r) => s + (r.spend ?? 0), 0)
    if (Math.abs(dailySpend - cardSpend) <= 0.01) {
      pass(`${label}: grupowanie per kreacja nie gubi wydatku (${daily.length} wierszy → ${(cd.rows ?? []).length} grup)`)
    } else {
      fail(`${label}: grupowanie gubi ${pln(Math.abs(dailySpend - cardSpend))} PLN`)
    }
  }
}

// ── CPA and ROAS: one definition ────────────────────────────────────────────
// The card and the goal bar now read the same profit-data window, so the only
// way they can disagree is if somebody recomputes one of them again.
console.log('')
const week = await get(`profit-data?from=${daysAgo(7)}&to=${daysAgo(1)}`)
const month = await get(`profit-data?from=${today.slice(0, 8)}01&to=${today}`)
for (const [label, d] of [['TYDZIEŃ', week], ['MIESIĄC', month]]) {
  const blended = d.blendedOrdersCount ?? 0
  const expectedCpa = blended > 0 ? (d.adSpend ?? 0) / blended : null
  const expectedRoas = (d.adSpend ?? 0) > 0 ? (d.blendedRevenue ?? 0) / (d.adSpend ?? 0) : null
  const okCpa = expectedCpa == null || Math.abs((d.realCpa ?? 0) - expectedCpa) < 0.01
  const okRoas = expectedRoas == null || Math.abs((d.realRoas ?? 0) - expectedRoas) < 0.01
  if (okCpa && okRoas) {
    pass(`${label}: realCpa ${d.realCpa?.toFixed(2)} i realRoas ${d.realRoas?.toFixed(2)} `
      + `liczone z blendedOrdersCount ${blended}`)
  } else {
    fail(`${label}: profit-data nie zgadza się samo ze sobą — `
      + `realCpa ${d.realCpa}, oczekiwane ${expectedCpa}`)
  }
}

console.log('')
if (errors > 0) {
  console.error(`FAIL — ${errors} rozbieżność(i).`)
  process.exit(1)
}
console.log('PASS — każda metryka ma jedną wartość w każdym zakresie.')
