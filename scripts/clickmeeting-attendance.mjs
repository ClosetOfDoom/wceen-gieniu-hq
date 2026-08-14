#!/usr/bin/env node
// ClickMeeting attendance → Supabase (webinar_attendance).
//
// Pulls every distinct clickmeeting_room_id out of webinar_sessions, asks
// ClickMeeting for that room's SESSIONS (which only exist once an event has
// actually taken place — empty/404 is normal, not an error), then pulls the
// ATTENDEES of each session and upserts them.
//
// Field mapping is NOT guessed: the script asserts the attendee keys it expects
// and halts with the raw payload printed if ClickMeeting returns a different
// shape, so a silently wrong mapping can never reach the database.
//
//   CLICKMEETING_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... \
//     node scripts/clickmeeting-attendance.mjs

const CM_KEY = process.env.CLICKMEETING_API_KEY
const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE

const CM_BASE = 'https://api.clickmeeting.com/v1'
const RATE_MS = 300 // pause between ClickMeeting calls
const TABLE = 'webinar_attendance'
const FUNNEL = 'v_webinar_funnel'

// ── env gate ────────────────────────────────────────────────────────────────
const missing = []
if (!CM_KEY) missing.push('CLICKMEETING_API_KEY')
if (!SB_URL) missing.push('SUPABASE_URL')
if (!SB_KEY) missing.push('SUPABASE_SERVICE_ROLE')
if (missing.length) {
  console.error('STOP — brak zmiennych srodowiskowych: ' + missing.join(', '))
  console.error('Bez nich nie ma jak sie uwierzytelnic. Nie probuje tego obchodzic.')
  console.error('Ustaw je i uruchom ponownie:')
  console.error('  CLICKMEETING_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE=... \\')
  console.error('    node scripts/clickmeeting-attendance.mjs')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── ClickMeeting ────────────────────────────────────────────────────────────
// Returns { status, body } — never throws on a non-2xx, because "room has no
// sessions yet" legitimately answers 404 and must not stop the run.
async function cmGet(path) {
  await sleep(RATE_MS)
  let res
  try {
    res = await fetch(CM_BASE + path, {
      headers: { 'X-Api-Key': CM_KEY, Accept: 'application/json' },
    })
  } catch (err) {
    return { status: 0, body: null, error: String(err?.message ?? err) }
  }
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

// ── Supabase / PostgREST ────────────────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function sbUpsert(rows) {
  const res = await fetch(`${SB_URL}/rest/v1/${TABLE}?on_conflict=clickmeeting_session_id,email`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  const text = await res.text()
  return { status: res.status, body: text }
}

// ── shape guards ────────────────────────────────────────────────────────────
// ClickMeeting wraps collections inconsistently across endpoints; accept a bare
// array or a single-key envelope around one, and refuse anything else.
function asArray(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const k of ['sessions', 'attendees', 'data', 'items', 'list']) {
      if (Array.isArray(body[k])) return body[k]
    }
  }
  return null
}

function haltUnexpected(what, raw) {
  console.error('')
  console.error('='.repeat(72))
  console.error(`STOP — ${what} ma inna strukture niz zakladane mapowanie.`)
  console.error('Nie zgaduje pol. Surowa odpowiedz ponizej:')
  console.error('='.repeat(72))
  console.error(JSON.stringify(raw, null, 2))
  process.exit(2)
}

const pick = (o, keys) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]
  return null
}

function secondsBetween(a, b) {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  const s = Math.round((tb - ta) / 1000)
  return s >= 0 ? s : null
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const report = {
    roomsTotal: 0,
    roomsProcessed: 0,
    roomsSkipped: [], // { room, status }
    sessions: 0,
    attendees: 0,
    upserted: 0,
    upsertErrors: [],
  }
  let firstAttendeesRaw = null
  let firstAttendeesCtx = null

  // 1. distinct rooms
  const roomsRes = await sbGet('webinar_sessions?select=clickmeeting_room_id')
  if (roomsRes.status !== 200 || !Array.isArray(roomsRes.body)) {
    console.error(`STOP — nie moge odczytac webinar_sessions (HTTP ${roomsRes.status}).`)
    console.error(JSON.stringify(roomsRes.body, null, 2))
    process.exit(1)
  }
  const rooms = [
    ...new Set(
      roomsRes.body
        .map((r) => r.clickmeeting_room_id)
        .filter((v) => v != null && String(v).trim() !== ''),
    ),
  ].map(String)
  report.roomsTotal = rooms.length
  console.log(`Pokoje (distinct clickmeeting_room_id): ${rooms.length}`)
  if (!rooms.length) console.log('  (brak pokojow do przetworzenia)')

  // 2. sessions per room
  for (const room of rooms) {
    const sres = await cmGet(`/conferences/${encodeURIComponent(room)}/sessions`)
    if (sres.status !== 200) {
      // 404 / empty = wydarzenie jeszcze sie nie odbylo. Loguj i jedz dalej.
      report.roomsSkipped.push({ room, status: sres.status })
      console.log(`  room ${room}: HTTP ${sres.status} — pomijam`)
      continue
    }
    const sessions = asArray(sres.body)
    if (sessions === null) haltUnexpected(`/conferences/${room}/sessions`, sres.body)
    if (!sessions.length) {
      report.roomsSkipped.push({ room, status: 200 })
      console.log(`  room ${room}: HTTP 200, 0 sesji — pomijam`)
      continue
    }
    report.roomsProcessed++
    console.log(`  room ${room}: HTTP 200, ${sessions.length} sesji`)

    // 3. attendees per session
    for (const sess of sessions) {
      const sessionId = pick(sess, ['id', 'session_id'])
      if (sessionId == null) haltUnexpected(`sesja w /conferences/${room}/sessions`, sess)
      const sessionStart = pick(sess, ['start_date', 'starts_at', 'start_time'])
      report.sessions++

      const ares = await cmGet(
        `/conferences/${encodeURIComponent(room)}/sessions/${encodeURIComponent(sessionId)}/attendees`,
      )
      if (ares.status !== 200) {
        console.log(`    session ${sessionId}: attendees HTTP ${ares.status} — pomijam`)
        continue
      }
      const attendees = asArray(ares.body)
      if (attendees === null) haltUnexpected(`/sessions/${sessionId}/attendees`, ares.body)
      if (!attendees.length) {
        console.log(`    session ${sessionId}: 0 uczestnikow`)
        continue
      }

      // Raw dump of the FIRST session that returned anything — real field names
      // on the table before anyone trusts the mapping below.
      if (!firstAttendeesRaw) {
        firstAttendeesRaw = ares.body
        firstAttendeesCtx = { room, sessionId }
      }

      // Mapping guard: every attendee must expose an e-mail under a known key.
      const sample = attendees[0]
      if (pick(sample, ['email', 'e_mail', 'mail']) == null) {
        haltUnexpected(`uczestnik w /sessions/${sessionId}/attendees (brak pola email)`, sample)
      }

      const rows = []
      for (const a of attendees) {
        const email = pick(a, ['email', 'e_mail', 'mail'])
        if (!email) continue
        const joined = pick(a, ['start_date', 'joined_at', 'join_time'])
        const left = pick(a, ['end_date', 'left_at', 'leave_time'])
        rows.push({
          clickmeeting_room_id: room,
          clickmeeting_session_id: String(sessionId),
          email: String(email).trim().toLowerCase(),
          login: pick(a, ['login', 'nickname', 'name']),
          attended: true,
          joined_at: joined,
          left_at: left,
          session_started_at: sessionStart,
          time_in_room_seconds: joined && left ? secondsBetween(joined, left) : null,
        })
      }
      report.attendees += rows.length

      if (rows.length) {
        const up = await sbUpsert(rows)
        if (up.status >= 200 && up.status < 300) {
          report.upserted += rows.length
          console.log(`    session ${sessionId}: ${rows.length} uczestnikow zapisanych`)
        } else {
          report.upsertErrors.push({ sessionId, status: up.status, body: up.body })
          console.log(`    session ${sessionId}: UPSERT HTTP ${up.status} — ${up.body}`)
        }
      }
    }
  }

  // ── RAPORT ────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(72))
  console.log('RAPORT')
  console.log('='.repeat(72))
  console.log(`Pokoje ogolem:       ${report.roomsTotal}`)
  console.log(`Pokoje przetworzone: ${report.roomsProcessed}`)
  console.log(`Pokoje pominiete:    ${report.roomsSkipped.length}`)
  for (const s of report.roomsSkipped) console.log(`  - room ${s.room}: HTTP ${s.status}`)
  console.log(`Sesje:               ${report.sessions}`)
  console.log(`Uczestnicy zapisani: ${report.upserted} (znalezionych: ${report.attendees})`)
  if (report.upsertErrors.length) {
    console.log(`Bledy upsertu:       ${report.upsertErrors.length}`)
    for (const e of report.upsertErrors) {
      console.log(`  - session ${e.sessionId}: HTTP ${e.status} ${e.body}`)
    }
  }

  console.log('\n--- Surowa odpowiedz attendees (pierwsza niepusta sesja) ---')
  if (firstAttendeesRaw) {
    console.log(`room=${firstAttendeesCtx.room} session=${firstAttendeesCtx.sessionId}`)
    console.log(JSON.stringify(firstAttendeesRaw, null, 2))
  } else {
    console.log('(zadna sesja nie zwrocila uczestnikow)')
  }

  console.log(`\n--- select count(*) from ${TABLE} ---`)
  const cnt = await fetch(`${SB_URL}/rest/v1/${TABLE}?select=*`, {
    method: 'HEAD',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  console.log(
    cnt.status === 200 || cnt.status === 206
      ? `count = ${(cnt.headers.get('content-range') || '').split('/')[1] ?? '?'}`
      : `HTTP ${cnt.status} — tabela ${TABLE} niedostepna`,
  )

  console.log(`\n--- select * from ${FUNNEL} order by session_started_at desc limit 10 ---`)
  const fn = await sbGet(`${FUNNEL}?select=*&order=session_started_at.desc&limit=10`)
  console.log(
    fn.status === 200 ? JSON.stringify(fn.body, null, 2) : `HTTP ${fn.status} — ${JSON.stringify(fn.body)}`,
  )
}

main().catch((err) => {
  console.error('STOP — nieobsluzony blad:', err)
  process.exit(1)
})
