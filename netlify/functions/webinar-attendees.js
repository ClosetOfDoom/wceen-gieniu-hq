// Per-session attendee list for the Webinars drill-down.
//
// Keyed by clickmeeting_room_id + clickmeeting_session_id — NEVER by webinar_id.
// The FK to webinars was dropped, so webinar_id is NULL on all 2292 attendance
// rows; joining on it is what made the panel look empty.
//
// Returns, per attendee: masked e-mail, login, time in room, and whether that
// person placed an order within 7 days AFTER the session start. Orders and
// attendance both need the service role (RLS blocks the anon key).
//
//   GET /.netlify/functions/webinar-attendees?room=10138835&session=45109700

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email ? email.slice(0, 4) + '…' : '—'
  const [local, domain] = email.split('@')
  if (!local || !domain) return '—'
  return local.slice(0, 2) + '***@' + domain
}

async function queryTable(supabaseUrl, serviceKey, table, params) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured', attendees: [] }),
    }
  }

  const room = (event.queryStringParameters || {}).room
  const session = (event.queryStringParameters || {}).session
  if (!room || !session) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: 'room and session query params are required', attendees: [] }),
    }
  }

  try {
    const rows = await queryTable(supabaseUrl, serviceKey, 'webinar_attendance', {
      select: 'email,login,attended,joined_at,left_at,session_started_at,time_in_room_seconds',
      clickmeeting_room_id: `eq.${room}`,
      clickmeeting_session_id: `eq.${session}`,
      limit: 2000,
    })

    // No row at all → we know nothing about this session, which is not the same
    // as "nobody came". The caller renders that difference.
    if (!rows.length) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ ok: true, hasData: false, attendees: [], sessionStartedAt: null }),
      }
    }

    const sessionStartedAt = rows.find((r) => r.session_started_at)?.session_started_at ?? null

    // Orders within [session start, session start + 7 days) for exactly these
    // e-mails. Window is anchored to the session, so "bought after the webinar"
    // never silently includes a purchase made before it.
    let orders = []
    let ordersError = null
    if (sessionStartedAt) {
      const startMs = Date.parse(sessionStartedAt)
      const endISO = new Date(startMs + 7 * 86400000).toISOString()
      try {
        orders = await queryTable(supabaseUrl, serviceKey, 'orders', {
          select: 'email,amount,order_created_at,product_name_raw',
          order_created_at: `gte.${sessionStartedAt}`,
          and: `(order_created_at.lt.${endISO})`,
          limit: 5000,
        })
      } catch (e) {
        ordersError = String(e?.message ?? e)
      }
    }

    const byEmail = new Map()
    for (const o of orders) {
      const em = String(o.email ?? '').trim().toLowerCase()
      if (!em) continue
      if (!byEmail.has(em)) byEmail.set(em, [])
      byEmail.get(em).push(o)
    }

    const attendees = rows
      .map((r) => {
        const em = String(r.email ?? '').trim().toLowerCase()
        const mine = byEmail.get(em) ?? []
        const secs = r.time_in_room_seconds != null
          ? Number(r.time_in_room_seconds)
          : r.joined_at && r.left_at
            ? Math.max(0, Math.round((Date.parse(r.left_at) - Date.parse(r.joined_at)) / 1000))
            : null
        return {
          email_masked: maskEmail(em),
          login: r.login ?? null,
          attended: r.attended === true,
          minutes: secs != null && Number.isFinite(secs) ? Math.round(secs / 60) : null,
          bought7d: mine.length > 0,
          bought_amount: mine.reduce((s, o) => s + (Number(o.amount) || 0), 0),
          bought_at: mine.length ? mine[0].order_created_at : null,
        }
      })
      .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1))

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        ok: true,
        hasData: true,
        sessionStartedAt,
        attendees,
        buyers: attendees.filter((a) => a.bought7d).length,
        ordersError,
      }),
    }
  } catch (e) {
    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ok: false, error: String(e?.message ?? e), attendees: [] }),
    }
  }
}
