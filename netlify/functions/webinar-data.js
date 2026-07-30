// Netlify Function: webinar-data
// Fetches webinar_sessions and webinar_participants using the Supabase service role key.
// The service role bypasses Row Level Security — the anon key cannot read these tables.
// Emails are masked server-side; raw emails never reach the frontend.
// Sessions are classified by the fixed WCEEN weekly schedule:
//   Thursday 18:00 Warsaw = JSU | Tuesday 18:00 Warsaw = JZK

import { classifyBySchedule } from './scheduleUtils.js'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

// ── Email helpers (mirrors clickmeetingNormalize.ts logic) ───────────────────

function extractEmail(value) {
  if (!value) return ''
  const str = String(value).trim()
  if (/^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i.test(str)) return str
  const m = str.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)
  return m ? m[0] : ''
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email ? email.slice(0, 4) + '…' : '—'
  const [local, domain] = email.split('@')
  if (!local || !domain) return '—'
  return local.slice(0, 2) + '***@' + domain
}

function extractRegistrationDate(emailFieldRaw, registeredAt, createdAt) {
  if (registeredAt) return registeredAt
  const m = String(emailFieldRaw ?? '').match(/"registration_date"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  if (createdAt) return createdAt
  return null
}

// ── Supabase REST query helper ────────────────────────────────────────────────

async function queryTable(supabaseUrl, serviceKey, table, params) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v))
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
    const missing = [
      !supabaseUrl   ? 'SUPABASE_URL'            : null,
      !serviceKey    ? 'SUPABASE_SERVICE_ROLE_KEY' : null,
    ].filter(Boolean).join(', ')
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: `Server env missing: ${missing}. Set these in Netlify → Site settings → Environment variables.`,
        debug: { source: 'netlify-function-service-role', sessionsError: 'env missing', participantsError: 'env missing' },
      }),
    }
  }

  let sessionsData      = null
  let participantsData  = null
  let sessionsError     = null
  let participantsError = null

  try {
    sessionsData = await queryTable(supabaseUrl, serviceKey, 'webinar_sessions', {
      select: '*',
      order:  'scheduled_at.desc',
      limit:  1000,   // fetch ALL sessions — limit:50 dropped the 12 oldest, so the
                      // panel's product_tag counts were short (35/13/2 vs 38/16/8).
    })
  } catch (e) {
    sessionsError = String(e?.message ?? e)
    console.error('webinar-data: sessions query failed:', sessionsError)
  }

  try {
    participantsData = await queryTable(supabaseUrl, serviceKey, 'webinar_participants', {
      select: 'id,session_id,email,registered_at,attended,attend_duration_min,purchased_at,purchase_value,wix_order_id,created_at',
      order:  'created_at.desc',
      limit:  1000,
    })
  } catch (e) {
    participantsError = String(e?.message ?? e)
    console.error('webinar-data: participants query failed:', participantsError)
  }

  // v_webinar_buyers — session registrants matched to their Wix orders by email.
  // SINGLE source for Sales / Revenue. The ORDER's product stays canonical-price
  // based (549 = JSU course) — this view only reports the email join, it does NOT
  // change order→product mapping.
  let buyersData  = null
  let buyersError = null
  try {
    buyersData = await queryTable(supabaseUrl, serviceKey, 'v_webinar_buyers', {
      select: '*',
      order:  'order_created_at.desc',
      limit:  5000,
    })
  } catch (e) {
    buyersError = String(e?.message ?? e)
    console.error('webinar-data: v_webinar_buyers query failed:', buyersError)
  }

  const sessions        = sessionsData        ?? []
  const rawParticipants = participantsData     ?? []
  const buyers          = buyersData          ?? []

  // Per-session buyer aggregates, keyed by scheduled_at. JSU course = amount 549.
  const JSU_COURSE_PRICE = 549
  const buyerAgg    = new Map()   // scheduled_at -> { revenue, jsu_course_*, other_* }
  const buyerEmails = new Map()   // scheduled_at -> Set(email)
  for (const r of buyers) {
    const key = r.scheduled_at
    const amt = Number(r.amount) || 0
    const g = buyerAgg.get(key) || { revenue: 0, jsu_course_sales: 0, jsu_course_revenue: 0, other_sales: 0, other_revenue: 0 }
    g.revenue += amt
    if (amt === JSU_COURSE_PRICE) { g.jsu_course_sales++; g.jsu_course_revenue += amt }
    else { g.other_sales++; g.other_revenue += amt }
    buyerAgg.set(key, g)
    if (!buyerEmails.has(key)) buyerEmails.set(key, new Set())
    buyerEmails.get(key).add(String(r.email ?? '').trim().toLowerCase())
  }

  // Compute unique emails before masking
  const uniqueEmails = new Set(
    rawParticipants
      .map(p => extractEmail(String(p.email ?? '')).toLowerCase())
      .filter(e => e.includes('@'))
  )

  // Sanitize: mask emails, extract registered_at from JSON blobs
  const participants = rawParticipants.map(p => {
    const rawEmail = String(p.email ?? '')
    const email    = extractEmail(rawEmail) || rawEmail
    return {
      id:                  p.id,
      session_id:          p.session_id,
      email_masked:        maskEmail(email),
      registered_at:       extractRegistrationDate(rawEmail, p.registered_at, p.created_at),
      attended:            p.attended   ?? null,
      attend_duration_min: p.attend_duration_min ?? null,
      purchased_at:        p.purchased_at  ?? null,
      purchase_value:      p.purchase_value ?? null,
      wix_order_id:        p.wix_order_id  ?? null,
    }
  })

  // Classify each session by the fixed weekly schedule
  const classifiedSessions = sessions.map(s => {
    const c = classifyBySchedule({ scheduled_at: s.scheduled_at, session_name: s.session_name, product_tag: s.product_tag })
    const agg = buyerAgg.get(s.scheduled_at)
    return {
      ...s,
      product_tag_schedule: c.product_tag,
      product_name_schedule: c.product_name,
      schedule_reason: c.reason,
      warsaw_weekday: c.warsaw_weekday,
      warsaw_time: c.warsaw_time,
      // Sales / Revenue from v_webinar_buyers (registrants of this session with an order)
      buyers_count:        buyerEmails.get(s.scheduled_at)?.size ?? 0,
      buyers_revenue:      agg?.revenue ?? 0,
      jsu_course_sales:    agg?.jsu_course_sales ?? 0,
      jsu_course_revenue:  agg?.jsu_course_revenue ?? 0,
      other_sales:         agg?.other_sales ?? 0,
      other_revenue:       agg?.other_revenue ?? 0,
    }
  })

  // Counts follow the DB product_tag (single source of truth), NOT name/schedule.
  const canonTag = (s) => { const t = String(s.product_tag ?? '').trim().toUpperCase(); return t === 'JSU' || t === 'JZK' ? t : 'UNKNOWN' }
  const jsuSessions     = classifiedSessions.filter(s => canonTag(s) === 'JSU')
  const jzkSessions     = classifiedSessions.filter(s => canonTag(s) === 'JZK')
  const unknownSessions = classifiedSessions.filter(s => canonTag(s) === 'UNKNOWN')

  console.log('webinar-data:', {
    sessions: sessions.length,
    jsuSessions: jsuSessions.length,
    jzkSessions: jzkSessions.length,
    participants: participants.length,
    uniqueEmails: uniqueEmails.size,
    sessionsError,
    participantsError,
  })

  return {
    statusCode: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ok:                 true,
      sessionsCount:      sessions.length,
      participantsCount:  participants.length,
      uniqueEmailsCount:  uniqueEmails.size,
      jsuSessionsCount:   jsuSessions.length,
      jzkSessionsCount:   jzkSessions.length,
      unknownSessionsCount: unknownSessions.length,
      sessions:           classifiedSessions,
      participants,
      // v_webinar_buyers rows (masked email) — the registrant⋈order join.
      webinarBuyers: buyers.map(r => ({
        session_name:     r.session_name,
        product_tag:      r.product_tag,
        scheduled_at:     r.scheduled_at,
        email_masked:     maskEmail(String(r.email ?? '')),
        product_name_raw: r.product_name_raw,
        amount:           Number(r.amount) || 0,
        is_jsu_course:    (Number(r.amount) || 0) === JSU_COURSE_PRICE,
        order_created_at: r.order_created_at,
      })),
      webinarBuyersTotals: {
        rows:               buyers.length,
        distinctBuyers:     new Set(buyers.map(r => String(r.email ?? '').trim().toLowerCase())).size,
        revenue:            buyers.reduce((s, r) => s + (Number(r.amount) || 0), 0),
        jsuCourseSales:     buyers.filter(r => (Number(r.amount) || 0) === JSU_COURSE_PRICE).length,
        jsuCourseRevenue:   buyers.filter(r => (Number(r.amount) || 0) === JSU_COURSE_PRICE).reduce((s, r) => s + (Number(r.amount) || 0), 0),
      },
      debug: {
        source:            'netlify-function-service-role',
        sessionsError,
        participantsError,
        buyersError,
        scheduleRule:      'Thu 18:00 Warsaw=JSU, Tue 18:00 Warsaw=JZK',
      },
    }),
  }
}
