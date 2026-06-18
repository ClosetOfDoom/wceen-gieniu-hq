import { supabase } from './supabase'
import { normalizeParticipantFields } from '../lib/clickmeetingNormalize'

// ── Types ────────────────────────────────────────────────────────────────────

export interface JsuFunnelRow {
  session_id: string
  session_name: string
  session_date: string
  scheduled_at: string
  product_tag: string | null
  registered_count: number
  attendee_count: number
  attendance_rate_pct: number | null
  purchases: number
  revenue: number
  purchase_rate_pct: number | null
  email_sent: number
  email_delivered: number
  email_opens: number
  email_clicks: number
}

export interface JsuParticipantRow {
  participant_id: string
  session_id: string
  email: string
  session_date: string
  session_name: string
  registered_at: string | null
  attended: boolean
  attend_duration_min: number | null
  purchased_at: string | null
  purchase_value: number | null
  wix_order_id: string | null
}

export type FunnelBottleneck =
  | 'NO_DATA'
  | 'NO_SOURCES'
  | 'DELIVERABILITY'
  | 'OPENS'
  | 'CLICKS'
  | 'REGISTRATIONS'
  | 'ATTENDANCE'
  | 'PURCHASE_PITCH'
  | 'PRODUCT_MAPPING'
  | 'OK'

export interface FunnelTotals {
  email_sent: number
  email_delivered: number
  email_opens: number
  email_clicks: number
  registered: number
  attendees: number
  purchases: number
  revenue: number
}

export interface FunnelRates {
  delivery_rate: number | null
  open_rate: number | null
  click_rate: number | null
  reg_rate: number | null
  attendance_rate: number | null
  purchase_rate: number | null
}

export interface JsuFunnelDebug {
  sessionsCount: number
  participantsCount: number
  uniqueEmails?: number
  registrationsFromParticipants?: boolean
  attendanceStatus?: 'populated' | 'not_populated'
  purchaseMappingStatus?: 'mapped' | 'not_mapped_yet'
  source: 'view' | 'raw_tables' | 'none'
  viewParticipants?: number
  rawParticipants?: number
  hasMismatch?: boolean
  latestSessionDate?: string
  latestSessionName?: string
  lastError?: string
}

export interface JsuFunnelSummary {
  sessions: JsuFunnelRow[]
  hasEmailData: boolean
  hasClickMeetingData: boolean
  bottleneck: FunnelBottleneck
  diagnosis: string
  totals: FunnelTotals
  rates: FunnelRates
  _debug?: JsuFunnelDebug
}

// ── Loaders ──────────────────────────────────────────────────────────────────

export async function loadJsuWebinarFunnel(): Promise<JsuFunnelSummary> {
  // ALWAYS query raw tables first — views can report 0 while raw table has rows
  const [{ data: rawSessions, error: sessErr }, { data: rawParticipants, error: partErr }] = await Promise.all([
    supabase
      .from('webinar_sessions')
      .select('*')
      .order('scheduled_at', { ascending: false })
      .limit(50),
    supabase
      .from('webinar_participants')
      // registration_date is NOT a real column — it only exists inside JSON blobs
      // stored in the email field. Extract it via normalizeParticipantFields() after fetch.
      .select('id, session_id, email, registered_at, attended, attend_duration_min, purchased_at, purchase_value, wix_order_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  if (sessErr) console.warn('webinar_sessions error:', sessErr.message)
  if (partErr) console.warn('webinar_participants error:', partErr.message)

  type RawSession = {
    id: string; session_name?: string; product_tag?: string
    scheduled_at?: string; ended_at?: string
    registered_count?: number; attendee_count?: number
  }
  type RawParticipant = {
    id?: string; session_id: string; email?: string | null
    registered_at?: string | null
    // registration_date NOT selected from DB — may appear dynamically from email JSON parsing
    attended?: boolean; attend_duration_min?: number | null
    purchased_at?: string | null; purchase_value?: number | null
    wix_order_id?: string | null; created_at?: string | null
  }

  const sessions    = (rawSessions    ?? []) as RawSession[]
  // If participant query failed, treat as empty — but still surface error in debug
  const rawPartRows = partErr ? [] : (rawParticipants ?? []) as RawParticipant[]

  const participantRows = rawPartRows.map(p => {
    const { email, registered_at } = normalizeParticipantFields({
      email: p.email, registered_at: p.registered_at,
      // registration_date not in DB; normalizeParticipantFields will parse it from email JSON if present
      created_at: p.created_at,
    })
    return { ...p, email, registered_at }
  })

  const uniqueEmails = new Set(
    participantRows.map(p => (p.email ?? '').toLowerCase()).filter(e => e.includes('@'))
  ).size

  if (sessions.length === 0 && participantRows.length === 0) {
    // Only true empty if BOTH failed — a participant query error still lets sessions show
    const errorMsg = sessErr?.message || partErr?.message
    console.log('GIENIU webinar: no raw data', { sessErr: sessErr?.message, partErr: partErr?.message })
    const empty = buildEmptySummary(partErr ? `Participant query error: ${partErr.message}` : errorMsg)
    empty._debug = {
      sessionsCount: 0, participantsCount: 0, source: 'none',
      lastError: errorMsg,
    }
    return empty
  }

  const registeredFromSessions = sessions.reduce((s, r) => s + (r.registered_count ?? 0), 0)
  const registered = registeredFromSessions > 0 ? registeredFromSessions : participantRows.length
  const registrationsFromParticipants = registeredFromSessions === 0 && participantRows.length > 0

  const attendeesFromSessions     = sessions.reduce((s, r) => s + (r.attendee_count ?? 0), 0)
  const attendeesFromParticipants = participantRows.filter(p => p.attended).length
  const attendees = attendeesFromSessions > 0 ? attendeesFromSessions : attendeesFromParticipants

  const purchases = participantRows.filter(p => p.purchased_at || p.wix_order_id).length
  const revenue   = participantRows.reduce((s, p) => s + (p.purchase_value ?? 0), 0)

  const hasClickMeetingData = registered > 0 || attendees > 0 || sessions.length > 0
  const attendanceRate = registered > 0 && attendees > 0 ? attendees / registered : null
  const purchaseRate   = attendees   > 0                  ? purchases / attendees  : null

  const syntheticRows: JsuFunnelRow[] = sessions.map(s => {
    const sp  = participantRows.filter(p => p.session_id === s.id)
    const spu = sp.filter(p => p.purchased_at || p.wix_order_id)
    const spr = sp.reduce((acc, p) => acc + (p.purchase_value ?? 0), 0)
    const spa = sp.filter(p => p.attended).length
    const reg = (s.registered_count ?? 0) > 0 ? s.registered_count! : sp.length
    const att = (s.attendee_count   ?? 0) > 0 ? s.attendee_count!   : spa
    return {
      session_id: s.id, session_name: s.session_name ?? s.id,
      session_date: s.scheduled_at?.slice(0, 10) ?? '', scheduled_at: s.scheduled_at ?? '',
      product_tag: s.product_tag ?? null,
      registered_count: reg, attendee_count: att,
      attendance_rate_pct: reg > 0 && att > 0 ? Math.round((att / reg) * 100) : null,
      purchases: spu.length, revenue: spr,
      purchase_rate_pct: att > 0 && spu.length > 0 ? Math.round((spu.length / att) * 100) : null,
      email_sent: 0, email_delivered: 0, email_opens: 0, email_clicks: 0,
    }
  })

  const totals: FunnelTotals = {
    email_sent: 0, email_delivered: 0, email_opens: 0, email_clicks: 0,
    registered, attendees, purchases, revenue,
  }
  const rates: FunnelRates = {
    delivery_rate: null, open_rate: null, click_rate: null, reg_rate: null,
    attendance_rate: attendanceRate, purchase_rate: purchaseRate,
  }

  const { bottleneck, diagnosis } = diagnose(totals, rates, false, hasClickMeetingData, participantRows.length)

  console.log('GIENIU webinar raw_tables', {
    sessions: sessions.length, participants: participantRows.length,
    uniqueEmails, registered, attendees, purchases, source: 'raw_tables',
  })

  return {
    sessions: syntheticRows, hasEmailData: false, hasClickMeetingData,
    bottleneck, diagnosis, totals, rates,
    _debug: {
      sessionsCount: sessions.length, participantsCount: participantRows.length,
      uniqueEmails, registrationsFromParticipants,
      source: 'raw_tables', rawParticipants: participantRows.length,
      latestSessionDate: sessions[0]?.scheduled_at?.slice(0, 10),
      latestSessionName: sessions[0]?.session_name,
      attendanceStatus:      attendees > 0 ? 'populated' : 'not_populated',
      purchaseMappingStatus: purchases > 0 ? 'mapped'    : 'not_mapped_yet',
      lastError: partErr ? `participant query: ${partErr.message}` : sessErr ? `sessions query: ${sessErr.message}` : undefined,
    },
  }
}

export async function loadJsuParticipantJourney(sessionId?: string): Promise<JsuParticipantRow[]> {
  let query = supabase
    .from('webinar_participants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (sessionId) query = query.eq('session_id', sessionId)
  const { data, error } = await query
  if (error) { console.warn('webinar_participants query error:', error.message); return [] }
  return ((data ?? []) as Record<string, unknown>[]).map(r => {
    const rawEmail = String(r.email ?? '')
    const { email, registered_at } = normalizeParticipantFields({
      email: rawEmail, registered_at: r.registered_at as string | null,
      // registration_date not a real DB column — normalizeParticipantFields parses it from email JSON
      created_at: r.created_at as string | null,
    })
    return {
      participant_id:      String(r.id ?? String(Math.random())),
      session_id:          String(r.session_id ?? ''), email,
      session_date:        String(r.session_date ?? registered_at?.slice(0, 10) ?? ''),
      session_name:        String(r.session_name ?? ''), registered_at,
      attended:            Boolean(r.attended ?? false),
      attend_duration_min: (r.attend_duration_min as number | null) ?? null,
      purchased_at:        (r.purchased_at as string | null) ?? null,
      purchase_value:      (r.purchase_value as number | null) ?? null,
      wix_order_id:        (r.wix_order_id as string | null) ?? null,
    }
  })
}

// ── Diagnosis ─────────────────────────────────────────────────────────────────

function buildEmptySummary(reason = ''): JsuFunnelSummary {
  return {
    sessions: [], hasEmailData: false, hasClickMeetingData: false, bottleneck: 'NO_DATA',
    diagnosis: reason || 'No webinar sessions in Supabase yet.',
    totals: { email_sent: 0, email_delivered: 0, email_opens: 0, email_clicks: 0, registered: 0, attendees: 0, purchases: 0, revenue: 0 },
    rates:  { delivery_rate: null, open_rate: null, click_rate: null, reg_rate: null, attendance_rate: null, purchase_rate: null },
  }
}

function diagnose(
  t: FunnelTotals, r: FunnelRates,
  hasEmail: boolean, hasClickMeeting: boolean, rawPartCount = 0,
): { bottleneck: FunnelBottleneck; diagnosis: string } {
  if (!hasEmail && !hasClickMeeting) {
    return { bottleneck: 'NO_SOURCES', diagnosis: 'No email or ClickMeeting data yet. Connect Make scenarios.' }
  }
  if (hasClickMeeting && t.registered > 0 && t.attendees === 0) {
    return {
      bottleneck: 'OK',
      diagnosis: `${t.registered} registration${t.registered !== 1 ? 's' : ''} found` +
        (rawPartCount > 0 ? ` (${rawPartCount} participant rows)` : '') +
        '. Attendance data is not populated yet. Purchases are not mapped yet.',
    }
  }
  if (hasEmail && r.delivery_rate !== null && r.delivery_rate < 0.85) {
    return { bottleneck: 'DELIVERABILITY', diagnosis: `Delivery rate is ${pct(r.delivery_rate)} — below 85%.` }
  }
  if (hasEmail && r.open_rate !== null && r.open_rate < 0.15) {
    return { bottleneck: 'OPENS', diagnosis: `Open rate is ${pct(r.open_rate)} — below 20-30% baseline.` }
  }
  if (hasEmail && r.click_rate !== null && r.click_rate < 0.02) {
    return { bottleneck: 'CLICKS', diagnosis: `Click rate is ${pct(r.click_rate)} — below 2%.` }
  }
  if (hasEmail && hasClickMeeting && r.reg_rate !== null && r.reg_rate < 0.05) {
    return { bottleneck: 'REGISTRATIONS', diagnosis: `Click-to-registration rate is ${pct(r.reg_rate)} — below 5%.` }
  }
  if (hasClickMeeting && r.attendance_rate !== null && r.attendance_rate < 0.60) {
    return { bottleneck: 'ATTENDANCE', diagnosis: `Attendance is ${pct(r.attendance_rate)} — below 60%. Check reminder sequence.` }
  }
  if (hasClickMeeting && r.purchase_rate !== null && r.purchase_rate < 0.03) {
    if (t.attendees > 5 && t.purchases === 0) {
      return { bottleneck: 'PRODUCT_MAPPING', diagnosis: `${t.attendees} attendees, zero purchases — check Wix order matching in Make.` }
    }
    return { bottleneck: 'PURCHASE_PITCH', diagnosis: `Attendee to purchase conversion is ${pct(r.purchase_rate)} — below 3%.` }
  }
  if (!hasEmail) {
    return { bottleneck: 'OK', diagnosis: 'No email data yet. ClickMeeting looks OK. Connect Make to ESP for full diagnosis.' }
  }
  if (!hasClickMeeting) {
    return { bottleneck: 'OK', diagnosis: 'No ClickMeeting data yet. Email looks OK. Connect Make to ClickMeeting.' }
  }
  return { bottleneck: 'OK', diagnosis: 'Funnel looks healthy. Check list segmentation if growth is stalling.' }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function pct(rate: number | null, decimals = 1): string {
  if (rate == null) return '—'
  return (rate * 100).toFixed(decimals) + '%'
}

export function fmtPlnFunnel(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
}
