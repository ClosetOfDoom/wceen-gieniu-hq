#!/usr/bin/env node
// Real-data verification for the profit / PP pipeline.
//
// Hits the DEPLOYED profit-data endpoint and reconciles it, order by order,
// against v_daily_wix_meta_performance — the aggregate view that reads the SAME
// `orders` table. If profit-data's order count or revenue disagrees with the
// view, the read is truncated or filtered wrong and this exits non-zero.
//
// Checking only for "profit == −(ad spend)" is too narrow: that is one symptom
// of one truncation. Three independent checks cover the CLASS of failure:
//
//   STALENESS  the newest order in the table is not older than today − 2 days.
//              A read that returns the OLDEST rows shows up here first.
//   CAP        no endpoint returns EXACTLY 1000 rows — that is the signature of
//              PostgREST's silent cap, not of a data set that happens to end.
//   RECONCILE  the endpoint's order count and revenue equal the daily view's for
//              the same range. The view aggregates the same table, so any gap
//              is a truncated read or a wrong filter.
//
//   npm run assert:profit-live               # today, yesterday, week
//   npm run assert:profit-live 2026-09-07    # plus one named day
//
// Runs in predeploy (npm run predeploy) as well as by hand. It needs the site
// to be reachable; with STANLEY_SKIP_LIVE=1 it reports that it was skipped
// rather than failing a build that has no network.
//
// Needs VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (the view is anon-readable);
// reads them from .env if they are not already in the environment.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

const SITE = process.env.STANLEY_SITE_URL ?? 'https://elegant-kelpie-6fdfc8.netlify.app'

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  const f = join(rootDir, '.env')
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const SUPA_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY

let errors = 0
const fail = (m) => { console.error('  FAIL', m); errors++ }
const pass = (m) => console.log('  pass', m)

const pln = (n) => Number(n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const warsawToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
const shiftDay = (iso, days) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

/** Monday of the ISO week containing a YYYY-MM-DD date. */
function weekStartOf(iso) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

async function getJson(url, label) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-store' } })
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`)
  return res.json()
}

/** The aggregate view: the independent witness for orders + revenue + spend. */
async function viewRange(from, to) {
  const url = `${SUPA_URL}/rest/v1/v_daily_wix_meta_performance`
    + `?select=date,wix_orders,wix_revenue,meta_spend&date=gte.${from}&date=lte.${to}&order=date.asc&limit=400`
  const rows = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } })
    .then(r => r.json())
  return {
    days:    rows.length,
    orders:  rows.reduce((s, r) => s + Number(r.wix_orders ?? 0), 0),
    revenue: rows.reduce((s, r) => s + Number(r.wix_revenue ?? 0), 0),
    spend:   rows.reduce((s, r) => s + Number(r.meta_spend ?? 0), 0),
  }
}

const profitData = (from, to) =>
  getJson(`${SITE}/.netlify/functions/profit-data?from=${from}&to=${to}&debug=1`, 'profit-data')

// ── one range ────────────────────────────────────────────────────────────────
async function checkRange(label, from, to) {
  console.log(`\n═══ ${label}  (${from} → ${to}) ═══`)

  const [d, v] = await Promise.all([profitData(from, to), viewRange(from, to)])
  if (!d.ok) { fail(`${label}: profit-data returned ok:false — ${d.error}`); return }

  // Per-order table. This is the artefact worth reading: every order, what it
  // was classified as, and the margin it earned.
  const rows = d.debugOrders ?? []
  if (rows.length > 0) {
    console.log('\n  order_id                              | suma     | produkt              | scope    | marża  | bucket')
    console.log('  ' + '-'.repeat(112))
    for (const o of rows) {
      console.log(
        '  ' + String(o.order_id ?? '—').padEnd(37) +
        ' | ' + String(pln(o.amount)).padStart(8) +
        ' | ' + String(o.product ?? '—').padEnd(20) +
        ' | ' + String(o.scope ?? '—').padEnd(8) +
        ' | ' + String(o.margin ?? 0).padStart(6) +
        ' | ' + o.bucket,
      )
    }
  }

  console.log('')
  console.log(`  orders            = ${d.ordersCount}          (view: ${v.orders})`)
  console.log(`  revenue           = ${pln(d.revenue)}   (view: ${pln(v.revenue)})`)
  console.log(`  ad spend          = ${pln(d.adSpend)}   (view: ${pln(v.spend)})  source: ${d.adSpendSource}`)
  console.log(`  margin total      = ${pln(d.marginBeforeAds)}`)
  console.log(`  EST. PROFIT       = ${pln(d.estimatedProfitAfterAds)}`)
  console.log(`  no-margin orders  = ${d.noMarginOrdersCount ?? 0}  (revenue ${pln(d.noMarginRevenue)})`)
  console.log(`  day-boundary      = ${d.dayBoundaryOrders ?? 0} order(s) whose UTC day ≠ Warsaw day`)
  if ((d.noMarginFields ?? []).length > 0) {
    for (const f of d.noMarginFields) console.log(`      failed field: ${f}`)
  }
  for (const p of d.productBreakdown ?? []) {
    console.log(`  · ${p.displayName.padEnd(22)} ${String(p.orders).padStart(3)} zam. · ${String(pln(p.revenue)).padStart(9)} · marża ${pln(p.marginTotal)}`)
  }

  // ── reconciliation ────────────────────────────────────────────────────────
  // The view counts count(*) on paid, non-test wix rows; profit-data groups rows
  // by order id. A gap here means a truncated read or a wrong filter.
  // RECONCILE — the view aggregates the same `orders` table with the same
  // predicate (source / paid / not a test row), so the counts must agree apart
  // from ONE known difference: the view buckets by `order_created_at::date`,
  // the UTC day, while this endpoint buckets by the Warsaw day. Orders placed
  // 22:00-24:00 UTC land on different days in the two places. profit-data
  // reports exactly how many of its orders sit in that window
  // (dayBoundaryOrders), so the slack is a measured number, not a fudge — and
  // an actual truncation is hundreds of orders, never one or two.
  //
  // supabase/migrations/view_daily_performance_warsaw_day.sql removes the
  // difference at the source. Until it is applied by hand in Supabase, a
  // single-day check tolerates the boundary and says so.
  const boundary = d.dayBoundaryOrders ?? 0
  // Orders can shift INTO the range as well as out of it, so the window is
  // the measured count plus one day's worth at the far edge.
  const slack = boundary + 1
  const orderGap = d.ordersCount - v.orders

  if (orderGap === 0) {
    pass(`RECONCILE ${label}: order count matches the view exactly (${d.ordersCount})`)
  } else if (Math.abs(orderGap) <= slack) {
    pass(`RECONCILE ${label}: ${d.ordersCount} vs view ${v.orders} (gap ${orderGap}) — within the `
       + `UTC-vs-Warsaw day boundary (${boundary} order(s) in the 22:00-24:00 UTC window). `
       + 'Apply view_daily_performance_warsaw_day.sql to make this exact.')
  } else {
    fail(`RECONCILE ${label}: profit-data has ${d.ordersCount} orders, view has ${v.orders} `
       + `(gap ${orderGap}), more than the ${slack} the day boundary can explain — `
       + 'truncated read or filter mismatch')
  }

  // Revenue gets the same treatment, bounded by the value of the shifted
  // orders rather than by a percentage.
  const revGap = d.revenue - v.revenue
  const perOrder = d.ordersCount > 0 ? d.revenue / d.ordersCount : 0
  const revSlack = slack * perOrder + 0.01
  if (Math.abs(revGap) < 0.01) {
    pass(`RECONCILE ${label}: revenue matches the view exactly (${pln(d.revenue)})`)
  } else if (Math.abs(revGap) <= revSlack) {
    pass(`RECONCILE ${label}: revenue ${pln(d.revenue)} vs view ${pln(v.revenue)} `
       + `(gap ${pln(revGap)}) — the same day-boundary orders`)
  } else {
    fail(`RECONCILE ${label}: profit-data revenue ${pln(d.revenue)} vs view ${pln(v.revenue)} `
       + `(gap ${pln(revGap)}), beyond the ${pln(revSlack)} the day boundary can explain`)
  }
  if (Math.abs(d.adSpend - v.spend) < 0.01) {
    pass(`${label}: ad spend matches the view (${pln(d.adSpend)})`)
  } else {
    fail(`${label}: profit-data ad spend ${pln(d.adSpend)} vs view ${pln(v.spend)}`)
  }

  // Est. Profit exactly equal to −(ad spend) with orders on the books is the
  // exact signature of the truncation bug.
  const isNegSpend = v.orders > 0 && Math.abs(d.estimatedProfitAfterAds + d.adSpend) < 0.01 && d.adSpend > 0
  if (isNegSpend) {
    fail(`${label}: Est. Profit is exactly −(ad spend) while the view shows ${v.orders} orders — margin computed over zero rows`)
  } else if (v.orders > 0) {
    pass(`${label}: Est. Profit is not the −(ad spend) signature`)
  }

  // Arithmetic must close: profit = summed margin − ad spend, nothing hidden.
  const summed = (d.productBreakdown ?? []).reduce((s, p) => s + p.marginTotal, 0)
  if (Math.abs(summed - d.marginBeforeAds) < 0.01) {
    pass(`${label}: product margins sum to marginBeforeAds (${pln(summed)})`)
  } else {
    fail(`${label}: product margins sum to ${pln(summed)} but marginBeforeAds is ${pln(d.marginBeforeAds)}`)
  }
  if (Math.abs((d.marginBeforeAds - d.adSpend) - d.estimatedProfitAfterAds) < 0.01) {
    pass(`${label}: profit = margin − ad spend`)
  } else {
    fail(`${label}: profit ${pln(d.estimatedProfitAfterAds)} ≠ margin ${pln(d.marginBeforeAds)} − spend ${pln(d.adSpend)}`)
  }

  // Every order is accounted for in exactly one bucket.
  const mapped = (d.productBreakdown ?? []).reduce((s, p) => s + p.orders, 0)
  const accounted = mapped + (d.noMarginOrdersCount ?? 0) + (d.excludedOrdersCount ?? 0)
  if (accounted === d.ordersCount) {
    pass(`${label}: every order is in exactly one bucket (${mapped} mapped + `
       + `${d.noMarginOrdersCount ?? 0} no-margin + ${d.excludedOrdersCount ?? 0} excluded)`)
  } else {
    fail(`${label}: ${d.ordersCount} orders but ${accounted} accounted for — an order fell through the buckets`)
  }

  // An order without a margin must always name the field the match broke on.
  if ((d.noMarginOrdersCount ?? 0) > 0 && (d.noMarginFields ?? []).length === 0) {
    fail(`${label}: ${d.noMarginOrdersCount} orders earned no margin but no failing field was reported`)
  }

  // EXCLUDED (WSZTP) is a decision, not a gap: it must never be folded into the
  // no-margin count, and every blended figure must leave its revenue out.
  const excl = d.excludedOrdersCount ?? 0
  if (excl > 0) {
    console.log(`  WSZTP (poza blended) = ${excl} zam. · ${pln(d.excludedRevenue)}`)
    if (Math.abs((d.blendedRevenue ?? 0) - (d.revenue - (d.excludedRevenue ?? 0))) < 0.01) {
      pass(`${label}: blended revenue leaves out the ${pln(d.excludedRevenue)} of WSZTP`)
    } else {
      fail(`${label}: blendedRevenue ${pln(d.blendedRevenue)} ≠ revenue ${pln(d.revenue)} − excluded ${pln(d.excludedRevenue)}`)
    }
    if ((d.blendedOrdersCount ?? 0) === d.ordersCount - excl) {
      pass(`${label}: blended order count leaves out the ${excl} WSZTP order(s)`)
    } else {
      fail(`${label}: blendedOrdersCount ${d.blendedOrdersCount} ≠ ${d.ordersCount} − ${excl}`)
    }
    if (d.realCpa != null && (d.blendedOrdersCount ?? 0) > 0
        && Math.abs(d.realCpa - d.adSpend / d.blendedOrdersCount) > 0.01) {
      fail(`${label}: realCpa ${d.realCpa} is not ad spend ÷ blended orders`)
    }
  }
  return d
}

// ── 1. STALENESS ───────────────────────────────────────────────────────
// The newest order date the pipeline can SEE. An unordered, capped read makes
// this stick at some date in the past while orders keep arriving — which is
// exactly how the Est. Profit bug looked from outside (latest_order_date stuck
// on 2026-08-31 for a week). Two days of slack absorbs a genuinely quiet
// weekend without hiding a broken read.
const STALENESS_MAX_DAYS = 2

async function checkStaleness(today) {
  console.log('\n═══ STALENESS ═══')
  let od
  try {
    od = await getJson(`${SITE}/.netlify/functions/orders-data`, 'orders-data')
  } catch (e) {
    fail(`STALENESS: orders-data unreachable — ${String(e?.message ?? e)}`)
    return
  }
  const latest = od?.totals?.latest_order_date ?? null
  const cutoff = shiftDay(today, -STALENESS_MAX_DAYS)

  if (!latest) {
    fail(`STALENESS: orders-data reports no latest_order_date (error: ${od?.error ?? 'none given'})`)
    return
  }
  console.log(`  newest order the pipeline can see: ${latest}   (cutoff ${cutoff})`)
  if (latest >= cutoff) {
    pass(`STALENESS: latest order ${latest} is within ${STALENESS_MAX_DAYS} days of ${today}`)
  } else {
    fail(`STALE: the newest order the pipeline can see is ${latest}, older than ${cutoff}. `
       + 'Either ingestion stopped, or a read is returning the OLDEST rows again.')
  }
}

// ── 2. CAP ────────────────────────────────────────────────────────────
// Exactly 1000 rows is never a coincidence: that is where PostgREST caps a
// response. Any row count that lands on it is truncated, whatever the endpoint
// claims. A COUNT query may legitimately return 1000, so those are exempt.
const CAP = 1000

async function checkCap() {
  console.log('\n═══ CAP ═══')
  const weekStart = weekStartOf(warsawToday())
  const probes = [
    ['orders-data', `${SITE}/.netlify/functions/orders-data`,
      d => [['totals.all_orders', d?.totals?.all_orders], ['totals.order_rows', d?.totals?.order_rows]]],
    ['profit-data (week)', `${SITE}/.netlify/functions/profit-data?from=${weekStart}&to=${warsawToday()}`,
      d => [['ordersCount', d?.ordersCount], ['orderRowsFetched', d?.orderRowsFetched]]],
    ['product-sales (370d)', `${SITE}/.netlify/functions/product-sales?days=370`,
      d => [['ordersScannedInRange', d?.ordersScannedInRange]]],
  ]
  for (const [label, url, extract] of probes) {
    let d
    try { d = await getJson(url, label) } catch (e) { fail(`CAP: ${label} — ${String(e?.message ?? e)}`); continue }
    for (const [field, value] of extract(d)) {
      if (value == null) continue
      console.log(`  ${label} · ${field} = ${value}`)
      if (value === CAP) {
        fail(`CAP: ${label} returned EXACTLY ${CAP} rows for ${field} — that is PostgREST's cap, `
           + 'so the read is truncated, not complete')
      } else {
        pass(`CAP: ${label} · ${field} = ${value} (not the ${CAP}-row cap)`)
      }
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
if (!SUPA_URL || !SUPA_KEY) {
  console.error('FAIL — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not available (checked env and .env)')
  process.exit(1)
}

if (process.env.STANLEY_SKIP_LIVE === '1') {
  console.log('SKIPPED — STANLEY_SKIP_LIVE=1 (offline build, no network)')
  process.exit(0)
}

const today = warsawToday()
const extra = process.argv[2]

console.log(`profit-live verification · site ${SITE} · Warsaw today ${today}`)

await checkStaleness(today)
await checkCap()
await checkRange('TODAY',     today,               today)
await checkRange('YESTERDAY', shiftDay(today, -1), shiftDay(today, -1))
await checkRange('WEEK',      weekStartOf(today),  today)
if (extra && /^\d{4}-\d{2}-\d{2}$/.test(extra) && extra !== today) {
  await checkRange(`DAY ${extra}`, extra, extra)
}

console.log('')
if (errors > 0) {
  console.error(`FAIL — ${errors} live profit violation(s).`)
  process.exit(1)
}
console.log('PASS — live profit pipeline reconciles with the daily view.')
