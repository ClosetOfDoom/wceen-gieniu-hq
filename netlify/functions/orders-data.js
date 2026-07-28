// Netlify Function: orders-data
// Canonical orders backend using service role (bypasses RLS).
// Provides classified order counts for today, this week, and all time.
// All UI and GIENIU answers for order queries must use this source.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function supabaseGet(supabaseUrl, serviceKey, table, filters = {}) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, item)
    } else {
      url.searchParams.set(k, String(v))
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} on ${table}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

function warsawToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

function warsawWeekStart() {
  const today = warsawToday()
  const d = new Date(today + 'T12:00:00Z')
  const dow = d.getUTCDay()
  const diff = (dow + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - diff)
  return monday.toISOString().slice(0, 10)
}

// Convert any order date value to a Warsaw calendar date (YYYY-MM-DD). Fixes
// UTC-vs-Warsaw off-by-one that dropped evening/early orders from "today".
function toWarsawDate(val) {
  if (val == null) return ''
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  try { return new Date(s).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) }
  catch { return s.slice(0, 10) }
}

function extractOrderDate(row) {
  return toWarsawDate(
    row.order_created_at ?? row.order_date ?? row.created_at ?? row.date ?? row.created ?? '',
  )
}

function extractAmount(row) {
  const candidates = [row.amount, row.total, row.price, row.revenue, row.order_total, row.price_total, row.total_price]
  for (const c of candidates) {
    const n = Number(c)
    if (!isNaN(n) && n > 0) return n
  }
  return 0
}

function extractEmail(row) {
  return row.buyer_email ?? row.email ?? row.customer_email ?? row.contact_email ?? ''
}

function extractProductNameRaw(row) {
  return row.product_name_raw ?? row.product_name ?? row.item_name ?? row.product_title ?? null
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '***@***'
  const [local, domain] = email.split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

// ── Absolute price classification (business rules, no keyword checks) ─────────
// 549 PLN = JSU_COURSE | 347 PLN = JZK_LANGUAGE (Językozak) | 119 PLN = MEMORY_PACK | 114 PLN = JZK_LANGUAGE (Pakiet Językowy)

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 'jak sie uczyc' removed — too broad; it would match PP bundle names where
// "Jak się uczyć" appears only as a bonus item, not the product itself.
const JSU_NAME_PATTERNS  = ['kurs jak sie uczyc', 'kurs jak', 'jsu', 'nauka uczenia', 'jak sie uczys']
const JZK_MAIN_PATTERNS  = ['jezykozak', 'jzk', 'nauka jezykow', 'nauka jezyk']
const LANG_PACK_PATTERNS = ['pakiet jezykowy', 'jezykowy']
const MEMORY_PATTERNS    = ['pakiet pamieciowy', 'trening pamiec', 'trening interaktywny', 'super pamiec', 'pamiec', 'memory pack']
// Intentionally narrow: 'memory' alone is too broad; 'jezyk' alone is too broad

function anyMatch(norm, patterns) {
  return patterns.some(p => norm.includes(p))
}

function classifyOrder(row) {
  const amount  = extractAmount(row)
  const rawName = extractProductNameRaw(row) ?? ''
  const norm    = normalizeText(rawName)

  if (amount === 549) {
    const nameContradicts = rawName.length > 0 && !anyMatch(norm, JSU_NAME_PATTERNS)
    return {
      classification: 'JSU_COURSE',
      productLabel:   'Kurs Jak się uczyć',
      reason:         'absolute price rule: 549 PLN = JSU',
      warning:        nameContradicts ? `product_name_raw "${rawName.slice(0, 50)}" doesn't match JSU patterns. Price rule used.` : null,
    }
  }
  if (amount === 347) {
    const nameContradicts = rawName.length > 0 && !anyMatch(norm, [...JZK_MAIN_PATTERNS, ...LANG_PACK_PATTERNS])
    return {
      classification: 'JZK_LANGUAGE',
      productLabel:   'Językozak AI',
      reason:         'absolute price rule: 347 PLN = Językozak AI',
      warning:        nameContradicts ? `product_name_raw "${rawName.slice(0, 50)}" doesn't match JZK patterns. Price rule used.` : null,
    }
  }
  if (amount === 119) {
    const nameContradicts = rawName.length > 0 && !anyMatch(norm, MEMORY_PATTERNS)
    return {
      classification: 'MEMORY_PACK',
      productLabel:   'Pakiet pamięciowy',
      reason:         'absolute price rule: 119 PLN = Pakiet Pamięciowy',
      warning:        nameContradicts ? `product_name_raw "${rawName.slice(0, 50)}" doesn't match memory patterns. Price rule used.` : null,
    }
  }
  if (amount === 114) {
    const nameContradicts = rawName.length > 0 && !anyMatch(norm, [...JZK_MAIN_PATTERNS, ...LANG_PACK_PATTERNS])
    return {
      classification: 'JZK_LANGUAGE',
      productLabel:   'Pakiet Językowy',
      reason:         'absolute price rule: 114 PLN = Pakiet Językowy',
      warning:        nameContradicts ? `product_name_raw "${rawName.slice(0, 50)}" doesn't match language pack patterns. Price rule used.` : null,
    }
  }

  // Name-only fallback: price unknown, but name clearly identifies the product
  if (rawName.length > 0) {
    if (anyMatch(norm, JSU_NAME_PATTERNS))
      return { classification: 'JSU_COURSE',   productLabel: 'Kurs Jak się uczyć', reason: `name-only: "${rawName.slice(0, 40)}"`, warning: `price ${amount} PLN not in rules; classified by name` }
    if (anyMatch(norm, JZK_MAIN_PATTERNS))
      return { classification: 'JZK_LANGUAGE', productLabel: 'Językozak AI',        reason: `name-only: "${rawName.slice(0, 40)}"`, warning: `price ${amount} PLN not in rules; classified by name` }
    if (anyMatch(norm, LANG_PACK_PATTERNS))
      return { classification: 'JZK_LANGUAGE', productLabel: 'Pakiet Językowy',     reason: `name-only: "${rawName.slice(0, 40)}"`, warning: `price ${amount} PLN not in rules; classified by name` }
    if (anyMatch(norm, MEMORY_PATTERNS))
      return { classification: 'MEMORY_PACK',  productLabel: 'Pakiet pamięciowy',   reason: `name-only: "${rawName.slice(0, 40)}"`, warning: `price ${amount} PLN not in rules; classified by name` }
  }

  return {
    classification: 'UNKNOWN',
    productLabel:   'Nieznany',
    reason:         `no price rule or name match (amount: ${amount} PLN)`,
    warning:        null,
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    const missing = [!supabaseUrl && 'SUPABASE_URL', !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: `Server env missing: ${missing}` }),
    }
  }

  const today     = warsawToday()
  const weekStart = warsawWeekStart()

  // ── Try orders table, fall back to wix_orders ─────────────────────────────

  let allOrders = []
  let usedTable = 'none'
  let fetchError = null

  for (const tableName of ['orders', 'wix_orders']) {
    try {
      const data = await supabaseGet(supabaseUrl, serviceKey, tableName, {
        select: '*',
        limit:  '500',
      })
      allOrders = data
      usedTable = tableName
      break
    } catch (e) {
      fetchError = String(e?.message ?? e)
    }
  }

  if (usedTable === 'none') {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok:    false,
        error: `Could not access orders table: ${fetchError}`,
        today_warsaw: today,
        week_start:   weekStart,
      }),
    }
  }

  // ── Classify and aggregate ────────────────────────────────────────────────

  let totalCount = allOrders.length
  let latestOrderDate = null

  let todayCount   = 0, todayRevenue   = 0
  let weekCount    = 0, weekRevenue    = 0
  let jsuCount     = 0, jsuRevenue     = 0
  let jzkCount     = 0, jzkRevenue     = 0
  let memoryCount  = 0, memoryRevenue  = 0
  let unknownCount = 0
  let priceWarnings = 0

  // Today-specific per-product breakdown
  let jsuTodayCount = 0, jsuTodayRevenue = 0
  let jzkTodayCount = 0, jzkTodayRevenue = 0
  let memoryTodayCount = 0, memoryTodayRevenue = 0
  let unknownTodayCount = 0

  const latest20 = []

  // Sort descending by date
  allOrders.sort((a, b) => {
    const da = extractOrderDate(a), db = extractOrderDate(b)
    return db.localeCompare(da)
  })

  for (const row of allOrders) {
    const d   = extractOrderDate(row)
    const amt = extractAmount(row)
    const cls = classifyOrder(row)

    if (!latestOrderDate && d) latestOrderDate = d

    if (d === today) {
      todayCount++
      todayRevenue += amt
      // Per-product breakdown for today
      if (cls.classification === 'JSU_COURSE')        { jsuTodayCount++;    jsuTodayRevenue    += amt }
      else if (cls.classification === 'JZK_LANGUAGE') { jzkTodayCount++;    jzkTodayRevenue    += amt }
      else if (cls.classification === 'MEMORY_PACK')  { memoryTodayCount++; memoryTodayRevenue += amt }
      else                                             { unknownTodayCount++ }
    }
    if (d >= weekStart) {
      weekCount++
      weekRevenue += amt
    }

    if (cls.warning) priceWarnings++
    if (cls.classification === 'JSU_COURSE')    { jsuCount++;    jsuRevenue    += amt }
    else if (cls.classification === 'JZK_LANGUAGE')  { jzkCount++;    jzkRevenue    += amt }
    else if (cls.classification === 'MEMORY_PACK')   { memoryCount++; memoryRevenue += amt }
    else                                              { unknownCount++ }

    if (latest20.length < 20) {
      latest20.push({
        external_order_id:    row.external_order_id ?? row.id ?? '—',
        email_masked:         maskEmail(extractEmail(row)),
        product_name_raw:     extractProductNameRaw(row) ?? '—',
        amount:               amt,
        order_date:           d,
        classified_product:   cls.classification,
        product_label:        cls.productLabel,
        classification_reason: cls.reason,
        classification_warning: cls.warning,
      })
    }
  }

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok:           true,
      timestamp:    new Date().toISOString(),
      today_warsaw: today,
      week_start:   weekStart,
      source_table: usedTable,
      totals: {
        all_orders:     totalCount,
        latest_order_date: latestOrderDate,
        today_orders:   todayCount,
        today_revenue:  todayRevenue,
        week_orders:    weekCount,
        week_revenue:   weekRevenue,
      },
      classified: {
        jsu_course:   { count: jsuCount,    revenue: jsuRevenue    },
        jzk_language: { count: jzkCount,    revenue: jzkRevenue    },
        memory_pack:  { count: memoryCount, revenue: memoryRevenue },
        unknown:      { count: unknownCount },
        price_warnings: priceWarnings,
      },
      today_classified: {
        jsu_course:   { count: jsuTodayCount,    revenue: jsuTodayRevenue    },
        jzk_language: { count: jzkTodayCount,    revenue: jzkTodayRevenue    },
        memory_pack:  { count: memoryTodayCount, revenue: memoryTodayRevenue },
        unknown:      { count: unknownTodayCount },
      },
      latest_20_orders: latest20,
    }),
  }
}
