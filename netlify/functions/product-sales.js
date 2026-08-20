// Netlify Function: product-sales
//
// JSU (549 PLN) and Językozak AI (347 PLN) sales computed from the `orders`
// table ALONE, using the canonical price table. No ClickMeeting, no
// registrations, no attendance — those pipelines stopped and anything derived
// from them would be a promise the data can no longer keep.
//
// Buckets by Warsaw calendar day and by ISO week (Monday start), each with the
// buyer list behind it. E-mails are masked, matching every other surface here.
//
//   GET /.netlify/functions/product-sales?days=30

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

// ── canonical price table ───────────────────────────────────────────────────
// The single rule for this view. An order is JSU or JZK by PRICE; the raw
// product name rides along so a mismatch is visible rather than silently
// reclassified.
const CANONICAL = {
  549: { key: 'jsu', label: 'Kurs Jak się uczyć' },
  347: { key: 'jzk', label: 'Językozak AI' },
}

async function supabaseGet(supabaseUrl, serviceKey, table, filters = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, String(v))
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} on ${table}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

const warsawToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

// Warsaw calendar date for any timestamp — avoids the UTC off-by-one that drops
// late-evening orders into the previous day.
function toWarsawDate(val) {
  if (val == null) return ''
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try {
    return new Date(s).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  } catch {
    return s.slice(0, 10)
  }
}

/** Monday of the ISO week containing a YYYY-MM-DD date. */
function weekStartOf(dateISO) {
  const d = new Date(dateISO + 'T12:00:00Z')
  const diff = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - diff)
  return d.toISOString().slice(0, 10)
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***'
  const [local, domain] = email.split('@')
  return `${local.slice(0, Math.min(2, local.length))}***@${domain}`
}

const extractEmail = (r) => r.buyer_email ?? r.email ?? r.customer_email ?? r.contact_email ?? ''
const extractDate = (r) => r.order_created_at ?? r.order_date ?? r.created_at ?? r.date ?? ''
const extractName = (r) => r.product_name_raw ?? r.product_name ?? r.item_name ?? null

function extractAmount(r) {
  for (const c of [r.amount, r.total, r.price, r.revenue, r.order_total]) {
    const n = Number(c)
    if (!isNaN(n) && n > 0) return n
  }
  return 0
}

const emptyBucket = () => ({ jsu: { count: 0, revenue: 0, buyers: [] }, jzk: { count: 0, revenue: 0, buyers: [] } })

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }),
    }
  }

  const days = Math.min(370, Math.max(1, parseInt((event.queryStringParameters || {}).days ?? '30', 10) || 30))
  const today = warsawToday()
  const fromISO = new Date(Date.parse(today + 'T12:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10)

  let rows = []
  let usedTable = 'none'
  let fetchError = null
  for (const table of ['orders', 'wix_orders']) {
    try {
      rows = await supabaseGet(supabaseUrl, serviceKey, table, {
        select: '*',
        order: 'order_created_at.desc',
        limit: 10000,
      })
      usedTable = table
      fetchError = null
      break
    } catch (e) {
      fetchError = String(e?.message ?? e)
    }
  }
  if (usedTable === 'none') {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: `Could not read orders: ${fetchError}` }) }
  }

  const byDay = new Map()
  const byWeek = new Map()
  const totals = emptyBucket()
  let scanned = 0

  for (const r of rows) {
    const date = toWarsawDate(extractDate(r))
    if (!date || date < fromISO || date > today) continue
    scanned++

    const amount = extractAmount(r)
    const hit = CANONICAL[amount]
    if (!hit) continue

    const buyer = {
      email: maskEmail(String(extractEmail(r)).trim().toLowerCase()),
      amount,
      date,
      at: extractDate(r),
      product_name_raw: extractName(r),
    }

    for (const [map, key] of [[byDay, date], [byWeek, weekStartOf(date)]]) {
      if (!map.has(key)) map.set(key, emptyBucket())
      const b = map.get(key)[hit.key]
      b.count++
      b.revenue += amount
      b.buyers.push(buyer)
    }
    totals[hit.key].count++
    totals[hit.key].revenue += amount
    totals[hit.key].buyers.push(buyer)
  }

  const serialise = (map) =>
    [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, v]) => ({ key, ...v }))

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      ok: true,
      source_table: usedTable,
      today_warsaw: today,
      from: fromISO,
      days,
      ordersScannedInRange: scanned,
      priceTable: { 549: 'Kurs Jak się uczyć (JSU)', 347: 'Językozak AI' },
      totals,
      byDay: serialise(byDay),
      byWeek: serialise(byWeek),
    }),
  }
}
