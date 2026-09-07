// ═══════════════════════════════════════════════════════════════════════════════
// supabaseRead.js — the ONLY way a Netlify Function reads from Supabase.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// PostgREST caps every response at 1000 rows. The cap is silent: ask for
// `limit=5000` and you get 1000 rows and a 200 OK. Worse, without an ORDER BY
// the 1000 you get are in physical table order — the OLDEST rows. Two functions
// read `orders` that way, and once the table passed 1000 rows every newer order
// became invisible: margin was summed over an empty set, so Est. Profit read
// exactly −(ad spend) and the PP counter read 0.
//
// That was a CLASS of bug, not one mistake. Eleven other reads across this
// directory had the same shape. So the fix is not a patch per call site: every
// read goes through readTable() here, which REFUSES to run without an explicit
// order column and pages past the cap on its own.
//
// THE RULES readTable ENFORCES
//   1. `order` is required. No order → throw, loudly, at call time.
//   2. A request for more than one page is paged, not truncated.
//   3. A page that comes back exactly full is followed by another request, so
//      hitting the cap can never be mistaken for reaching the end.
// ═══════════════════════════════════════════════════════════════════════════════

/** PostgREST's hard per-response row cap. Not configurable from the client. */
export const PAGE = 1000

function buildUrl(supabaseUrl, table, params) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    // Repeated keys are ANDed by PostgREST — that is how a date range is passed.
    if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, String(item)) }
    else { url.searchParams.set(k, String(v)) }
  }
  return url.toString()
}

async function request(supabaseUrl, serviceKey, table, params, extraHeaders = {}) {
  const res = await fetch(buildUrl(supabaseUrl, table, params), {
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...extraHeaders,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} on ${table}: ${body.slice(0, 200)}`)
  }
  return { rows: await res.json(), contentRange: res.headers.get('content-range') }
}

/**
 * Read rows from a table or view, paging past the 1000-row cap.
 *
 * @param {string} supabaseUrl
 * @param {string} serviceKey
 * @param {string} table
 * @param {object} opts
 * @param {string}  opts.order    REQUIRED. PostgREST order clause, e.g.
 *                                'order_created_at.desc' or 'date.asc'. A read
 *                                without one returns rows in physical order,
 *                                which is what caused the Est. Profit bug.
 * @param {string} [opts.select]  Defaults to '*'.
 * @param {number} [opts.limit]   Total rows wanted. Above PAGE it is paged.
 *                                Omit (or pass Infinity) to read everything.
 * @param {object} [opts.filters] PostgREST filters, e.g.
 *                                { date: ['gte.2026-09-01', 'lte.2026-09-07'] }.
 */
export async function readTable(supabaseUrl, serviceKey, table, opts = {}) {
  const { order, select = '*', limit, filters = {} } = opts

  if (!order || typeof order !== 'string') {
    throw new Error(
      `readTable(${table}): an explicit \`order\` is required. Without ORDER BY, ` +
      `PostgREST returns rows in physical order and silently caps the response at ` +
      `${PAGE} rows — you would get the OLDEST rows and never know.`,
    )
  }

  const want = limit == null ? Infinity : Number(limit)
  const all = []
  for (let offset = 0; all.length < want; offset += PAGE) {
    const pageSize = Math.min(PAGE, want - all.length)
    const { rows } = await request(supabaseUrl, serviceKey, table, {
      ...filters, select, order, limit: String(pageSize), offset: String(offset),
    })
    all.push(...rows)
    // A short page is the real end of the data. A full page might be the cap,
    // so we always ask again.
    if (rows.length < pageSize) break
  }
  return all
}

/** Exact row count, without transferring any rows. */
export async function countTable(supabaseUrl, serviceKey, table, filters = {}) {
  const { contentRange } = await request(
    supabaseUrl, serviceKey, table,
    { ...filters, select: '*', limit: '1' },
    { 'Prefer': 'count=exact', 'Range': '0-0' },
  )
  const n = Number(String(contentRange ?? '').split('/')[1])
  return Number.isFinite(n) ? n : null
}

/**
 * readTable that returns [] instead of throwing, for the diagnostic endpoints
 * that must still render when one table is unreachable. The error is returned,
 * never swallowed.
 */
export async function tryReadTable(supabaseUrl, serviceKey, table, opts = {}) {
  try {
    return { ok: true, rows: await readTable(supabaseUrl, serviceKey, table, opts), error: null }
  } catch (e) {
    return { ok: false, rows: [], error: String(e?.message ?? e) }
  }
}
