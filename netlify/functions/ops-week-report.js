// Netlify Function: ops-week-report
// Full weekly operational report using service role (bypasses RLS).
// Reports JSU/JZK webinar sessions, participants, Wix order classification,
// and email attribution of webinar participants to JSU sales.
// Classification uses the WCEEN fixed weekly schedule:
//   Thursday 18:00 Warsaw = JSU | Tuesday 18:00 Warsaw = JZK

import { classifyBySchedule } from './scheduleUtils.js'

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

// ── Session classification (uses fixed schedule — Thu 18:00=JSU, Tue 18:00=JZK) ──

function isJsuSession(session) {
  return classifyBySchedule(session).product_tag === 'JSU'
}

function isJzkSession(session) {
  return classifyBySchedule(session).product_tag === 'JZK'
}

// ── Order product classifier ──────────────────────────────────────────────────

const JSU_NAME_PATTERNS    = ['jak sie uczyc', 'kurs jak sie', 'jsu']
const MEMORY_NAME_119      = ['pamiec', 'trening interaktywny', 'pakiet pamieciowy', 'memory']
const JZK_NAME_PATTERNS    = ['jezykozak', 'jezykowy', 'nauka jezykow', 'jzk', 'jezyk']
const MEMORY_PACK_PATTERNS = ['pakiet pamieciowy', 'pamieciowy', 'memory pack', 'memory bundle', 'pakiet mix']

function classifyText(text) {
  const n = normalizeText(text)
  if (n.length === 0) return null
  if (JSU_NAME_PATTERNS.some(p => n.includes(p)))    return 'JSU_COURSE'
  if (MEMORY_PACK_PATTERNS.some(p => n.includes(p))) return 'MEMORY_PACK'
  if (JZK_NAME_PATTERNS.some(p => n.includes(p)))    return 'JZK_LANGUAGE'
  return null
}

function extractAmount(row) {
  const candidates = [row.amount, row.total, row.price, row.revenue, row.order_total, row.price_total, row.total_price]
  for (const c of candidates) {
    const n = Number(c)
    if (!isNaN(n) && n > 0) return n
  }
  return 0
}

function maskEmail(email) {
  if (!email || !String(email).includes('@')) return '***@***'
  const [local, domain] = String(email).split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}

function extractProductNameRaw(row) {
  return row.product_name_raw ?? row.product_name ?? row.item_name ?? row.product_title ?? row.name ?? null
}

/**
 * Absolute price rules — no keyword checks needed.
 * 549 PLN = JSU_COURSE | 347 PLN = JZK_LANGUAGE | 119 PLN = MEMORY_PACK
 * Warning only when product_name_raw contradicts the price rule.
 * Text fallback for other amounts.
 */
function classifyOrder(row) {
  const amount  = extractAmount(row)
  const rawName = extractProductNameRaw(row) ?? ''
  const norm    = normalizeText(rawName)

  // Absolute rule 1: 549 PLN = JSU course
  if (amount === 549) {
    const nameContradicts = rawName.length > 0 && !JSU_NAME_PATTERNS.some(p => norm.includes(p))
    return {
      classification: 'JSU_COURSE',
      productLabel:   'Kurs Jak się uczyć',
      reason:         'absolute price rule: 549 PLN = JSU',
      warning: nameContradicts
        ? `Wix product_name_raw is misleading ("${rawName.slice(0, 50)}"). Price rule used.`
        : null,
    }
  }

  // Absolute rule 2: 347 PLN = Językozak AI
  if (amount === 347) {
    const nameContradicts = rawName.length > 0 && !JZK_NAME_PATTERNS.some(p => norm.includes(p))
    return {
      classification: 'JZK_LANGUAGE',
      productLabel:   'Językozak AI',
      reason:         'absolute price rule: 347 PLN = Językozak AI',
      warning: nameContradicts
        ? `Wix product_name_raw is misleading ("${rawName.slice(0, 50)}"). Price rule used.`
        : null,
    }
  }

  // Absolute rule 3: 119 PLN = memory pack
  if (amount === 119) {
    const nameContradicts = rawName.length > 0 && !MEMORY_NAME_119.some(p => norm.includes(p))
    return {
      classification: 'MEMORY_PACK',
      productLabel:   'Pakiet pamięciowy',
      reason:         'absolute price rule: 119 PLN = memory pack',
      warning: nameContradicts
        ? `Wix product_name_raw is misleading ("${rawName.slice(0, 50)}"). Price rule used.`
        : null,
    }
  }

  // Name explicitly says JSU (no price match needed)
  if (JSU_NAME_PATTERNS.some(p => norm.includes(p))) {
    return { classification: 'JSU_COURSE', productLabel: 'Kurs Jak się uczyć', reason: 'product name matches JSU pattern', warning: null }
  }

  // Text fallback for other amounts
  const candidates = [rawName, row.description, row.sku]
  for (const key of ['line_items', 'items', 'raw', 'raw_payload']) {
    const v = row[key]
    if (v && typeof v === 'object') candidates.push(JSON.stringify(v))
    else if (typeof v === 'string') candidates.push(v)
  }
  for (const c of candidates) {
    if (!c) continue
    const r = classifyText(String(c))
    if (r) return { classification: r, productLabel: r, reason: `text match in product data (amount: ${amount})`, warning: null }
  }
  return { classification: 'UNKNOWN', productLabel: 'Nieznany', reason: `no price rule or text match (amount: ${amount} PLN)`, warning: null }
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

  // ── Classify sessions (schedule rule: Thu 18:00=JSU, Tue 18:00=JZK) ──────────

  const allJsuSessions   = sessions.filter(isJsuSession)
  const allJzkSessions   = sessions.filter(isJzkSession)
  const yesterdaySess    = sessions.filter(s => (s.scheduled_at ?? '').slice(0, 10) === yesterday)
  const yesterdayJsuSess = yesterdaySess.filter(isJsuSession)
  const yesterdayJzkSess = yesterdaySess.filter(isJzkSession)

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

  const jsuParticipants     = participants.filter(p => allJsuSessions.some(s => s.id === p.session_id))
  const jzkParticipants     = participants.filter(p => allJzkSessions.some(s => s.id === p.session_id))
  const yesterdayJsuSessIds = new Set(yesterdayJsuSess.map(s => s.id))
  const yesterdayJzkSessIds = new Set(yesterdayJzkSess.map(s => s.id))
  const yesterdayJsuPartic  = participants.filter(p => yesterdayJsuSessIds.has(p.session_id))
  const yesterdayJzkPartic  = participants.filter(p => yesterdayJzkSessIds.has(p.session_id))

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

  // ── Try raw orders for product classification ─────────────────────────────────
  // Try 'orders' first (actual Supabase table name), fall back to 'wix_orders' for legacy

  let rawOrders = []
  let wixOrdersError = null
  let ordersTable = 'none'
  const orderTableErrors = {}
  const orderTableCandidates = ['orders', 'wix_orders']
  for (const tableName of orderTableCandidates) {
    try {
      const rawOrderData = await supabaseGet(supabaseUrl, serviceKey, tableName, {
        select: '*',
        limit:  200,
      })
      rawOrders = rawOrderData
      ordersTable = tableName
      debug.wixOrdersTableExists = true
      const sample = rawOrders[0] ?? {}
      const productFields = ['product_name_raw', 'product_name', 'item_name', 'product_title', 'line_items', 'sku']
      debug.wixOrdersHasProductData = productFields.some(f => f in sample && sample[f] != null)
      const emailFields = ['buyer_email', 'email', 'customer_email', 'contact_email']
      debug.wixOrdersHasEmailData = emailFields.some(f => f in sample && sample[f] != null)
      // Filter for this week client-side
      rawOrders = rawOrders.filter(r => {
        const d = (r.order_date ?? r.created_at ?? r.date ?? r.created ?? '').slice(0, 10)
        return !d || d >= weekStart
      })
      wixOrdersError = null
      debug.wixOrdersError = null
      break
    } catch (e) {
      const errMsg = String(e?.message ?? e)
      orderTableErrors[tableName] = errMsg
      wixOrdersError = errMsg
      debug.wixOrdersError = errMsg
    }
  }
  if (ordersTable === 'none') {
    debug.wixOrdersError = Object.entries(orderTableErrors)
      .map(([t, e]) => `${t}: ${e.slice(0, 100)}`)
      .join(' | ')
  }

  // ── Classify raw orders ───────────────────────────────────────────────────────

  let jsuCourseOrders = 0, jsuCourseRevenue = 0
  let memoryPackOrders = 0, memoryPackRevenue = 0
  let jzkOrders = 0
  let unclassifiedOrders = 0
  let priceWarningsCount = 0
  let jsuYesterdayOrders = 0, jsuYesterdayRevenue = 0
  let yesterdayAllRawOrders = 0

  const classifiedRawOrders = []
  const orderDiagnostics = []

  if (debug.wixOrdersTableExists && rawOrders.length > 0) {
    for (const row of rawOrders) {
      const result    = classifyOrder(row)
      const orderDate = (row.order_date ?? row.created_at ?? row.date ?? '').slice(0, 10)
      const isYesterday = orderDate === yesterday
      const amount    = extractAmount(row)
      const email     = extractOrderEmail(row)
      const rawName   = extractProductNameRaw(row)
      const extId     = row.external_order_id ?? row.id ?? null

      classifiedRawOrders.push({ ...row, _classification: result.classification, _date: orderDate, _email: email })

      if (result.warning) priceWarningsCount++

      orderDiagnostics.push({
        external_order_id:       extId,
        email_masked:            email ? maskEmail(email) : '(no email)',
        product_name_raw:        rawName,
        amount,
        classified_product:      result.classification,
        product_label:           result.productLabel,
        classification_reason:   result.reason,
        classification_warning:  result.warning ?? null,
      })

      if (isYesterday) yesterdayAllRawOrders++

      switch (result.classification) {
        case 'JSU_COURSE':
          jsuCourseOrders++; jsuCourseRevenue += amount
          if (isYesterday) { jsuYesterdayOrders++; jsuYesterdayRevenue += amount }
          break
        case 'MEMORY_PACK':
          memoryPackOrders++; memoryPackRevenue += amount
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

  // ── Build response sessions with participant counts and schedule classification ─

  const sessionReport = sessions.map(s => {
    const classified = classifyBySchedule(s)
    const pCount = participants.filter(p => p.session_id === s.id).length
    return {
      session_id:      s.id,
      session_name:    s.session_name ?? s.id,
      scheduled_at:    s.scheduled_at,
      date:            (s.scheduled_at ?? '').slice(0, 10),
      product_tag:     classified.product_tag,
      product_name:    classified.product_name,
      schedule_reason: classified.reason,
      warsaw_weekday:  classified.warsaw_weekday,
      warsaw_time:     classified.warsaw_time,
      is_jsu:          classified.product_tag === 'JSU',
      is_jzk:          classified.product_tag === 'JZK',
      participants:    pCount,
    }
  })

  const jsuSessionReport       = sessionReport.filter(s => s.is_jsu)
  const jzkSessionReport       = sessionReport.filter(s => s.is_jzk)
  const yesterdaySessionReport = sessionReport.filter(s => s.date === yesterday)
  const yesterdayJsuReport     = yesterdaySessionReport.filter(s => s.is_jsu)
  const yesterdayJzkReport     = yesterdaySessionReport.filter(s => s.is_jzk)

  console.log('ops-week-report:', {
    weekStart, today, yesterday,
    sessions: sessions.length,
    jsuSessions: allJsuSessions.length, jzkSessions: allJzkSessions.length,
    participants: participants.length,
    jsuParticipants: jsuParticipants.length, jzkParticipants: jzkParticipants.length,
    yesterdayJsuSessions: yesterdayJsuSess.length, yesterdayJzkSessions: yesterdayJzkSess.length,
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
          jzk_sessions:     allJzkSessions.length,
          jzk_participants: jzkParticipants.length,
          all_participants: participants.length,
          sessions:         sessionReport,
          jsu_sessions_list: jsuSessionReport,
          jzk_sessions_list: jzkSessionReport,
        },
        yesterday: {
          all_sessions:     yesterdaySess.length,
          jsu_sessions:     yesterdayJsuSess.length,
          jsu_participants: yesterdayJsuPartic.length,
          jzk_sessions:     yesterdayJzkSess.length,
          jzk_participants: yesterdayJzkPartic.length,
          jsu_sessions_list: yesterdayJsuReport,
          jzk_sessions_list: yesterdayJzkReport,
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
          price_warnings_count:    priceWarningsCount,
          order_diagnostics:       orderDiagnostics,
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
        jzk_webinar_ran_yesterday:     yesterdayJzkSess.length > 0,
        jsu_sales_this_week:           jsuCourseOrders,
        jsu_sales_yesterday:           jsuYesterdayOrders,
        memory_pack_sales_this_week:   memoryPackOrders,
        total_participants_this_week:  participants.length,
        jsu_participants_this_week:    jsuParticipants.length,
        jzk_participants_this_week:    jzkParticipants.length,
      },
      debug: {
        source:                   'ops-week-report-service-role',
        scheduleRule:             'Thu 18:00 Warsaw=JSU, Tue 18:00 Warsaw=JZK',
        ordersTable,
        priceRulesApplied:        true,
        wixOrdersTableExists:     debug.wixOrdersTableExists,
        wixOrdersHasProductData:  debug.wixOrdersHasProductData,
        wixOrdersHasEmailData:    debug.wixOrdersHasEmailData,
        wixOrdersError,
        orderTableErrors,
        webinarSessionsError:     debug.webinarSessionsError,
        webinarParticipantsError: debug.webinarParticipantsError,
        wixPerformanceError:      debug.wixPerformanceError,
        orderClassificationSource,
      },
    }),
  }
}
