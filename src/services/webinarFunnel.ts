// Webinar funnel data loader.
// PRIMARY SOURCE: /.netlify/functions/webinar-data (service role — bypasses RLS).
// The anon key cannot read webinar_sessions or webinar_participants due to RLS.
// Direct Supabase anon queries will return 0 rows even when the table has data.
import { bustUrl } from '../utils/cacheBust'

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
  // Product breakdown from v_webinar_buyers — JSU course (549) vs the rest.
  // Sales/Revenue/breakdown count ONLY orders placed AFTER the webinar (conversions).
  jsu_course_sales?: number
  jsu_course_revenue?: number
  other_sales?: number
  other_revenue?: number
  // Pre-webinar customers: orders placed BEFORE the session (funnel entries, not conversions).
  pre_webinar_count?: number
  pre_webinar_revenue?: number
  purchase_rate_pct: number | null
  email_sent: number
  email_delivered: number
  email_opens: number
  email_clicks: number
}

export interface ParticipantPurchase {
  amount: number
  product_name_raw: string | null
  order_created_at: string | null
  phase: 'before' | 'after'
  is_jsu_course: boolean
}

export type AttendanceStatus = 'present' | 'absent' | 'no_data'

export interface JsuParticipantRow {
  participant_id: string
  session_id: string
  email: string
  session_date: string
  session_name: string
  registered_at: string | null
  registered_at_missing: boolean
  attendance_status: AttendanceStatus
  attended: boolean
  attend_duration_min: number | null
  bought: boolean
  bought_before: boolean
  bought_after: boolean
  purchases: ParticipantPurchase[]
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
  source: 'view' | 'raw_tables' | 'none' | 'backend-function'
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

// ── Backend response types ────────────────────────────────────────────────────

interface BackendParticipant {
  id: string
  session_id: string
  email_masked: string
  registered_at: string | null
  registered_at_missing?: boolean
  attendance_status?: AttendanceStatus
  attended: boolean | null
  attend_duration_min: number | null
  bought?: boolean
  bought_before?: boolean
  bought_after?: boolean
  purchases?: ParticipantPurchase[]
  purchased_at: string | null
  purchase_value: number | null
  wix_order_id: string | null
}

interface BackendSession {
  id: string
  session_name?: string
  product_tag?: string | null
  scheduled_at?: string
  registered_count?: number
  attendee_count?: number
  // Buyer aggregates from v_webinar_buyers (attached by webinar-data function)
  buyers_count?: number
  buyers_revenue?: number
  jsu_course_sales?: number
  jsu_course_revenue?: number
  other_sales?: number
  other_revenue?: number
  pre_webinar_count?: number
  pre_webinar_revenue?: number
}

interface WebinarBackendResponse {
  ok: boolean
  sessionsCount: number
  participantsCount: number
  uniqueEmailsCount: number
  sessions: BackendSession[]
  participants: BackendParticipant[]
  attendancePopulated?: boolean
  registeredAtMissingCount?: number
  debug: {
    source: string
    sessionsError: string | null
    participantsError: string | null
    attendanceStatus?: 'populated' | 'not_populated'
    attendanceError?: string | null
  }
  error?: string
}

// ── Backend fetch ─────────────────────────────────────────────────────────────

async function fetchWebinarBackend(): Promise<WebinarBackendResponse> {
  const res = await fetch(bustUrl('/.netlify/functions/webinar-data'), {
    headers: { 'Cache-Control': 'no-store' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'no response body')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<WebinarBackendResponse>
}

// ── Main loader ───────────────────────────────────────────────────────────────

export async function loadJsuWebinarFunnel(): Promise<JsuFunnelSummary> {
  // Backend function uses service role key — bypasses RLS that blocks anon queries.
  let backendData: WebinarBackendResponse | null = null
  let backendError: string | null = null

  try {
    backendData = await fetchWebinarBackend()
    if (!backendData.ok) {
      backendError = backendData.error ?? 'Backend returned ok: false'
    }
  } catch (e) {
    backendError = e instanceof Error ? e.message : String(e)
  }

  if (backendError || !backendData) {
    const msg = `Backend webinar-data failed: ${backendError ?? 'unknown error'}`
    console.error('GIENIU webinar backend error:', msg)
    const empty = buildEmptySummary(msg)
    empty._debug = { sessionsCount: 0, participantsCount: 0, source: 'none', lastError: msg }
    return empty
  }

  const { sessions, participants, uniqueEmailsCount, debug: backendDebug } = backendData

  const registeredFromSessions = sessions.reduce((s, r) => s + (r.registered_count ?? 0), 0)
  const registered = registeredFromSessions > 0 ? registeredFromSessions : participants.length
  const registrationsFromParticipants = registeredFromSessions === 0 && participants.length > 0

  const attendeesFromSessions     = sessions.reduce((s, r) => s + (r.attendee_count ?? 0), 0)
  const attendeesFromParticipants = participants.filter(p => p.attended).length
  const attendees = attendeesFromSessions > 0 ? attendeesFromSessions : attendeesFromParticipants

  // Sales / Revenue come from v_webinar_buyers (per-session aggregates attached by
  // the backend), NOT from participants (which carry no purchase data).
  const purchases = sessions.reduce((s, r) => s + (r.buyers_count ?? 0), 0)
  const revenue   = sessions.reduce((s, r) => s + (r.buyers_revenue ?? 0), 0)

  const hasClickMeetingData = registered > 0 || attendees > 0 || sessions.length > 0
  const attendanceRate = registered > 0 && attendees > 0 ? attendees / registered : null
  const purchaseRate   = attendees   > 0                  ? purchases / attendees  : null

  const syntheticRows: JsuFunnelRow[] = sessions.map(s => {
    const sp  = participants.filter(p => p.session_id === s.id)
    const spa = sp.filter(p => p.attended).length
    const reg = (s.registered_count ?? 0) > 0 ? s.registered_count! : sp.length
    const att = (s.attendee_count   ?? 0) > 0 ? s.attendee_count!   : spa
    const buyersCount = s.buyers_count ?? 0
    return {
      session_id: s.id, session_name: s.session_name ?? s.id,
      session_date: s.scheduled_at?.slice(0, 10) ?? '', scheduled_at: s.scheduled_at ?? '',
      product_tag: s.product_tag ?? null,
      registered_count: reg, attendee_count: att,
      attendance_rate_pct: reg > 0 && att > 0 ? Math.round((att / reg) * 100) : null,
      // Sales = registrants of this session with an order; Revenue = sum of amounts.
      purchases: buyersCount, revenue: s.buyers_revenue ?? 0,
      // Product breakdown: JSU course (549) separate from the rest (after-webinar only).
      jsu_course_sales:   s.jsu_course_sales   ?? 0,
      jsu_course_revenue: s.jsu_course_revenue ?? 0,
      other_sales:        s.other_sales        ?? 0,
      other_revenue:      s.other_revenue      ?? 0,
      // Pre-webinar customers (bought before the session) — shown separately, never in Sales.
      pre_webinar_count:   s.pre_webinar_count   ?? 0,
      pre_webinar_revenue: s.pre_webinar_revenue ?? 0,
      // NOTE: NOT divided by attendees — attendance is not populated (see below).
      purchase_rate_pct: null,
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

  const { bottleneck, diagnosis } = diagnose(totals, rates, false, hasClickMeetingData, participants.length)

  const partErr = backendDebug.participantsError
  const sessErr = backendDebug.sessionsError

  console.log('GIENIU webinar backend-function', {
    sessions: sessions.length, participants: participants.length,
    uniqueEmails: uniqueEmailsCount, registered, attendees, purchases,
  })

  return {
    sessions: syntheticRows, hasEmailData: false, hasClickMeetingData,
    bottleneck, diagnosis, totals, rates,
    _debug: {
      sessionsCount: sessions.length, participantsCount: participants.length,
      uniqueEmails: uniqueEmailsCount, registrationsFromParticipants,
      source: 'backend-function', rawParticipants: participants.length,
      latestSessionDate: sessions[0]?.scheduled_at?.slice(0, 10),
      latestSessionName: sessions[0]?.session_name,
      // Attendance status comes from the webinar_attendance table (backend), NOT from
      // a derived attendee count — an empty table means "unknown", never "nobody came".
      attendanceStatus:      backendDebug.attendanceStatus ?? (backendData.attendancePopulated ? 'populated' : 'not_populated'),
      purchaseMappingStatus: purchases > 0 ? 'mapped'    : 'not_mapped_yet',
      lastError: partErr ? `participant: ${partErr}` : sessErr ? `sessions: ${sessErr}` : undefined,
    },
  }
}

export async function loadJsuParticipantJourney(sessionId?: string): Promise<JsuParticipantRow[]> {
  let backendData: WebinarBackendResponse | null = null
  try {
    backendData = await fetchWebinarBackend()
  } catch (e) {
    console.warn('webinar-data backend failed for participant journey:', e)
    return []
  }
  if (!backendData?.ok) return []

  const rows = sessionId
    ? backendData.participants.filter(p => p.session_id === sessionId)
    : backendData.participants

  return rows.map(p => ({
    participant_id:        String(p.id ?? ''),
    session_id:            p.session_id,
    email:                 p.email_masked, // masked — only used for display
    session_date:          p.registered_at?.slice(0, 10) ?? '',
    session_name:          '',
    registered_at:         p.registered_at,
    registered_at_missing: p.registered_at_missing ?? (p.registered_at == null),
    attendance_status:     p.attendance_status ?? 'no_data',
    attended:              p.attended ?? false,
    attend_duration_min:   p.attend_duration_min ?? null,
    bought:                p.bought ?? false,
    bought_before:         p.bought_before ?? false,
    bought_after:          p.bought_after ?? false,
    purchases:             p.purchases ?? [],
    purchased_at:          p.purchased_at  ?? null,
    purchase_value:        p.purchase_value ?? null,
    wix_order_id:          p.wix_order_id  ?? null,
  }))
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

