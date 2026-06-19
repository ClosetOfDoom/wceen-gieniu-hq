// Netlify Function: ops-week-report
// Full weekly operational report using service role (bypasses RLS).
// Reports JSU webinar sessions, participants, Wix order classification,
// and email attribution of webinar participants to JSU sales.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Text normalisation ─────────────────────────────────────────────────────────

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── JSU session classifier ────────────────────────────────────────────────────

const JSU_SESSION_PATTERNS = [
  'pamiec', 'test pamieci', 'jak sie uczyc', 'jsu',
  'pamiec czwartek', 'pamietaj', 'webinar pamieci', 'memory',
]

function isJsuSession(session) {
  const tag = normalizeText(session.product_tag ?? '')
  if (tag === 'jsu') return true
  const name = normalizeText(session.session_name ?? '')
  return JSU_SESSION_PATTERNS.some(p => name.includes(p))
}

// ── Order product classifier ──────────────────────────────────────────────────

const JSU_ORDER_PATTERNS    = ['jak sie uczyc', 'kurs jak sie uczyc', 'jsu', '549']
const MEMORY_PACK_PATTERNS  = ['pakiet pamieciowy', 'pamieciowy', 'memory pack', 'memory bundle', 'pakiet mix']
const JZK_ORDER_PATTERNS    = ['jezykozak', 'pakiet jezykowy', 'nauka jezykow', 'jzk', 'jezykowy']

function classifyText(text) {
  const n = normalizeText(text)
  if (n.length === 0) return null
  if (JSU_ORDER_PATTERNS.some(p => n.includes(p)))   return 'JSU_COURSE'
  if (MEMORY_PACK_PATTERNS.some(p => n.includes(p))) return 'MEMORY_PACK'
  if (JZK_ORDER_PATTERNS.some(p => n.includes(p)))   return 'JZK_LANGUAGE'
  return null
}

function classifyOrder(row) {
  const candidates = [
    row.product_name, row.item_name, row.product_title, row.description, row.sku,
  ]
  // Serialise nested fields
  for (const key of ['line_items', 'items', 'raw', 'raw_payload']) {
    const v = row[key]
    if (v && typeof v === 'object') candidates.push(JSON.stringify(v))
    else if (typeof v === 'string') candidates.push(v)
  }
  for (const c of candidates) {
    if (!c) continue
    const r = classifyText(String(c))
    if (r) return r
  }
  return 'UNKNOWN'
}

function extractOrderEmail(row) {
  const candidates = [
    row.buyer_email, row.email, row.customer_email, row.contact_email,
    row.billing_email, row.shipping_email,
  ]
  for (const c of candidates) {
    if (c && String(c).includes('@')) return String(c).toLowerCase().trim()
  }
  // Try nested
  const payload = row.raw_payload || row.raw || {}
  if (typeof payload === 'object') {
    const nested = payload.buyerInfo?.email || payload.buyer?.email ||
                   payload.billingInfo?.email || payload.email
    if (nested) return String(nested).toLowerCase().trim()
  }
  return null
}

// ── Date ranges (Warsaw) ──────────────────────────────────────────────────────

function getWarsawRanges() {
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const [year, month, day] = todayStr.split('-').map(Number)

  const yesterdayD = new Date(year, month - 1, day - 1)
  const yesterdayStr = yesterdayD.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

  const todayDow     = new Date(year, month - 1, day).getDay() // 0=Sun,1=Mon
  const daysToMon    = todayDow === 0 ? 6 : todayDow - 1
  const weekStartD   = new Date(year, month - 1, day - daysToMon)
  const weekStartStr = weekStartD.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

  // Exclusive upper bound for Supabase gte/lt filters
  const tomorrowD   = new Date(year, month - 1, day + 1)
  const tomorrowStr = tomorrowD.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

  return {
    today:          todayStr,
    yesterday:      yesterdayStr,
    weekStart:      weekStartStr,
    weekEnd:        todayStr,
    tomorrow:       tomorrowStr,
    yesterdayStart: yesterdayStr,
    yesterdayEnd:   todayStr,
  }
}

// ── Supabase REST helper ──────────────────────────────────────────────────────

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
      body: JSON.stringify({
        ok: false,
        error: `Server env missing: ${missing}. Set in Netlify → Site settings → Environment variables.`,
      }),
    }
  }

  const ranges = getWarsawRanges()
  const { today, yesterday, weekStart, tomorrow } = ranges

  const debug = {
    source:                    'ops-week-report-service-role',
    ranges,
    webinarSessionsError:      null,
    webinarParticipantsError:  null,
    wixPerformanceError:       null,
    wixOrdersError:            null,
    wixOrdersTableExists:      false,
    wixOrdersHasProductData:   false,
    wixOrdersHasEmailData:     false,
  }

  // ── Fetch webinar sessions (this week) ───────────────────────────────────────

  let sessions = []
  try {
    sessions = await supabaseGet(supabaseUrl, serviceKey, 'webinar_sessions', {
      select:       '*',
      scheduled_at: [`gte.${weekStart}`, `lt.${tomorrow}`],
      order:        'scheduled_at.desc',
      limit:        50,
    })
  } catch (e) {
    debug.webinarSessionsError = String(e?.message ?? e)
    // Retry without date filter to get all sessions if date filter fails
    try {
      const all = await supabaseGet(supabaseUrl, serviceKey, 'webinar_sessions', {
        select: '*', order: 'scheduled_at.desc', limit: 50,
      })
      // Filter client-side for this week
      sessions = all.filter(s => {
        const d = (s.scheduled_at ?? s.date ?? '').slice(0, 10)
        return d >= weekStart && d <= today
      })
      debug.webinarSessionsError = `date-filter failed; used client-side filter: ${debug.webinarSessionsError}`
    } catch (e2) {
      debug.webinarSessionsError = String(e2?.message ?? e2)
    }
  }

  // ── Classify sessions ────────────────────────────────────────────────────────

  const allJsuSessions  = sessions.filter(isJsuSession)
  const yesterdaySess   = sessions.filter(s => (s.scheduled_at ?? '').slice(0, 10) === yesterday)
  const yesterdayJsuSess = yesterdaySess.filter(isJsuSession)

  // ── Fetch webinar participants for this week's sessions ──────────────────────

  let participants = []
  let allParticipants = []
  try {
    allParticipants = await supabaseGet(supabaseUrl, serviceKey, 'webinar_participants', {
      select: 'id,session_id,email,registered_at,attended,attend_duration_min,purchased_at,purchase_value,wix_order_id,created_at',
      order:  'created_at.desc',
      limit:  1000,
    })
  } catch (e) {
    debug.webinarParticipantsError = String(e?.message ?? e)
  }

  const weekSessionIds = new Set(sessions.map(s => s.id))
  participants = allParticipants.filter(p => weekSessionIds.has(p.session_id))
  if (participants.length === 0 && allParticipants.length > 0) {
    // Session IDs might not match — fallback to all participants
    participants = allParticipants
  }

  const jsuParticipants      = participants.filter(p => allJsuSessions.some(s => s.id === p.session_id))
  const yesterdayJsuSessIds  = new Set(yesterdayJsuSess.map(s => s.id))
  const yesterdayJsuPartic   = participants.filter(p => yesterdayJsuSessIds.has(p.session_id))

  // ── Fetch Wix performance (aggregate, by date range) ─────────────────────────

  let perfRows = []
  try {
    perfRows = await supabaseGet(supabaseUrl, serviceKey, 'v_daily_wix_meta_performance', {
      select: 'date,wix_orders,wix_revenue,meta_spend,impressions,link_clicks',
      date:   [`gte.${weekStart}`, `lte.${today}`],
      order:  'date.desc',
      limit:  10,
    })
  } catch (e) {
    debug.wixPerformanceError = String(e?.message ?? e)
  }

  const weekAllOrders  = perfRows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const weekAllRevenue = perfRows.reduce((s, r) => s + (r.wix_revenue  ?? 0), 0)
  const weekMetaSpend  = perfRows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const weekImpressions = perfRows.reduce((s, r) => s + (r.impressions ?? 0), 0)

  const yesterdayPerf  = perfRows.find(r => r.date === yesterday)
  const yesterdayAllOrders  = yesterdayPerf?.wix_orders  ?? 0
  const yesterdayAllRevenue = yesterdayPerf?.wix_revenue ?? 0

  // ── Try raw wix_orders for product classification ────────────────────────────

  let rawOrders = []
  let wixOrdersError = null
  try {
    const rawOrderData = await supabaseGet(supabaseUrl, serviceKey, 'wix_orders', {
      select: '*',
      limit:  200,
    })
    rawOrders = rawOrderData
    debug.wixOrdersTableExists = true
    const sample = rawOrders[0] ?? {}
    const productFields = ['product_name', 'item_name', 'product_title', 'line_items', 'items', 'raw', 'raw_payload', 'sku', 'description']
    debug.wixOrdersHasProductData = productFields.some(f => f in sample && sample[f] != null)
    const emailFields = ['buyer_email', 'email', 'customer_email', 'contact_email', 'billing_email']
    debug.wixOrdersHasEmailData = emailFields.some(f => f in sample) ||
      (sample.raw_payload && typeof sample.raw_payload === 'object' && 'buyerInfo' in sample.raw_payload)

    // Filter for this week client-side (try common date columns)
    rawOrders = rawOrders.filter(r => {
      const d = (r.order_date ?? r.created_at ?? r.date ?? r.ordered_at ?? '').slice(0, 10)
      return !d || d >= weekStart
    })
  } catch (e) {
    wixOrdersError = String(e?.message ?? e)
    debug.wixOrdersError = wixOrdersError
  }

  // ── Classify raw orders ───────────────────────────────────────────────────────

  let jsuCourseOrders = 0, jsuCourseRevenue = 0
  let memoryPackOrders = 0, memoryPackRevenue = 0
  let jzkOrders = 0
  let unclassifiedOrders = 0
  let jsuYesterdayOrders = 0, jsuYesterdayRevenue = 0
  let yesterdayAllRawOrders = 0

  const classifiedRawOrders = []

  if (debug.wixOrdersTableExists && rawOrders.length > 0) {
    for (const row of rawOrders) {
      const classification = classifyOrder(row)
      const orderDate = (row.order_date ?? row.created_at ?? row.date ?? '').slice(0, 10)
      const isYesterday = orderDate === yesterday
      const revenue = Number(row.total ?? row.price ?? row.amount ?? row.revenue ?? 0)
      const email   = extractOrderEmail(row)

      classifiedRawOrders.push({ ...row, _classification: classification, _date: orderDate, _email: email })

      if (isYesterday) yesterdayAllRawOrders++

      switch (classification) {
        case 'JSU_COURSE':
          jsuCourseOrders++; jsuCourseRevenue += revenue
          if (isYesterday) { jsuYesterdayOrders++; jsuYesterdayRevenue += revenue }
          break
        case 'MEMORY_PACK':
          memoryPackOrders++; memoryPackRevenue += revenue
          break
        case 'JZK_LANGUAGE':
          jzkOrders++; break
        default:
          unclassifiedOrders++; break
      }
    }
  }

  const productClassificationAvailable = debug.wixOrdersTableExists && debug.wixOrdersHasProductData
  const orderClassificationSource = productClassificationAvailable ? 'wix_orders' : 'v_daily_wix_meta_performance'

  // If no raw order product data, all orders are unclassified from aggregate source
  const finalUnclassifiedOrders = productClassificationAvailable
    ? unclassifiedOrders
    : weekAllOrders

  // ── Attribution: webinar participants → JSU sales ─────────────────────────────

  let attributedSales = 0
  let attributionReason = ''

  const yesterdayParticipantEmails = new Set(
    yesterdayJsuPartic
      .map(p => {
        const raw = String(p.email ?? '')
        const m = raw.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)
        return m ? m[0].toLowerCase() : raw.toLowerCase()
      })
      .filter(e => e.includes('@'))
  )

  const jsuOrderEmails = classifiedRawOrders
    .filter(o => o._classification === 'JSU_COURSE' && o._date >= yesterday)
    .map(o => o._email)
    .filter(Boolean)

  if (yesterdayJsuPartic.length === 0) {
    attributionReason = 'No yesterday JSU webinar participant data available for attribution.'
  } else if (jsuOrderEmails.length === 0 && !debug.wixOrdersHasEmailData) {
    attributionReason = 'JSU sale exists, but Wix order buyer email is missing, so attribution cannot be confirmed.'
  } else if (jsuOrderEmails.length === 0 && jsuCourseOrders === 0) {
    attributionReason = 'No JSU course orders found this week to attribute.'
  } else {
    for (const email of jsuOrderEmails) {
      if (yesterdayParticipantEmails.has(email)) {
        attributedSales++
      }
    }
    if (attributedSales > 0) {
      attributionReason = `${attributedSales} JSU sale(s) email-matched to yesterday's webinar participant list.`
    } else if (jsuCourseOrders > 0) {
      attributionReason = 'JSU sale exists, but buyer email does not match webinar participant email.'
    } else {
      attributionReason = 'No JSU course orders in the attribution window.'
    }
  }

  // ── Build response sessions with participant counts ───────────────────────────

  const sessionReport = sessions.map(s => {
    const pCount = participants.filter(p => p.session_id === s.id).length
    return {
      session_id:    s.id,
      session_name:  s.session_name ?? s.id,
      scheduled_at:  s.scheduled_at,
      date:          (s.scheduled_at ?? '').slice(0, 10),
      product_tag:   s.product_tag ?? null,
      is_jsu:        isJsuSession(s),
      participants:  pCount,
    }
  })

  const jsuSessionReport      = sessionReport.filter(s => s.is_jsu)
  const yesterdaySessionReport = sessionReport.filter(s => s.date === yesterday)
  const yesterdayJsuReport     = yesterdaySessionReport.filter(s => s.is_jsu)

  console.log('ops-week-report:', {
    weekStart, today, yesterday,
    sessions: sessions.length, jsuSessions: allJsuSessions.length,
    participants: participants.length, jsuParticipants: jsuParticipants.length,
    yesterdayJsuSessions: yesterdayJsuSess.length, yesterdayJsuParticipants: yesterdayJsuPartic.length,
    weekAllOrders, jsuCourseOrders, memoryPackOrders, unclassifiedOrders: finalUnclassifiedOrders,
    attributedSales, attributionReason,
  })

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok: true,
      range: {
        week_start:      weekStart,
        week_end:        today,
        yesterday:       yesterday,
        today:           today,
        yesterday_start: yesterday,
        yesterday_end:   today,
        timezone:        'Europe/Warsaw',
      },
      webinars: {
        this_week: {
          all_sessions:     sessions.length,
          jsu_sessions:     allJsuSessions.length,
          jsu_participants: jsuParticipants.length,
          all_participants: participants.length,
          sessions:         jsuSessionReport,
        },
        yesterday: {
          all_sessions:     yesterdaySess.length,
          jsu_sessions:     yesterdayJsuSess.length,
          jsu_participants: yesterdayJsuPartic.length,
          sessions:         yesterdayJsuReport,
        },
      },
      orders: {
        this_week: {
          all_orders:              weekAllOrders,
          all_revenue:             weekAllRevenue,
          jsu_course_orders:       jsuCourseOrders,
          jsu_course_revenue:      jsuCourseRevenue,
          memory_pack_orders:      memoryPackOrders,
          memory_pack_revenue:     memoryPackRevenue,
          jzk_orders:              jzkOrders,
          unclassified_orders:     finalUnclassifiedOrders,
          data_source:             orderClassificationSource,
          product_classification:  productClassificationAvailable ? 'available' : 'unavailable',
        },
        yesterday: {
          all_orders:         yesterdayAllOrders,
          all_revenue:        yesterdayAllRevenue,
          jsu_course_orders:  jsuYesterdayOrders,
          jsu_course_revenue: jsuYesterdayRevenue,
        },
      },
      attribution: {
        yesterday_webinar_participants: yesterdayJsuPartic.length,
        jsu_sales_after_webinar:        jsuCourseOrders,
        attributed_sales:               attributedSales,
        attribution_reason:             attributionReason,
      },
      meta: {
        this_week_spend:       weekMetaSpend,
        this_week_impressions: weekImpressions,
      },
      summary: {
        jsu_webinar_ran_yesterday:     yesterdayJsuSess.length > 0,
        jsu_sales_this_week:           jsuCourseOrders,
        jsu_sales_yesterday:           jsuYesterdayOrders,
        memory_pack_sales_this_week:   memoryPackOrders,
        total_participants_this_week:  participants.length,
        jsu_participants_this_week:    jsuParticipants.length,
      },
      debug: {
        source:                   'ops-week-report-service-role',
        wixOrdersTableExists:     debug.wixOrdersTableExists,
        wixOrdersHasProductData:  debug.wixOrdersHasProductData,
        wixOrdersHasEmailData:    debug.wixOrdersHasEmailData,
        wixOrdersError,
        webinarSessionsError:     debug.webinarSessionsError,
        webinarParticipantsError: debug.webinarParticipantsError,
        wixPerformanceError:      debug.wixPerformanceError,
        orderClassificationSource,
      },
    }),
  }
}
