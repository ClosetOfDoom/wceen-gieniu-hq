import { supabase } from './supabase'
import { extractEmail, extractRegistrationDate, normalizeParticipantFields } from '../lib/clickmeetingNormalize'

// ── Types ────────────────────────────────────────────────────────────────────

export interface JsuFunnelRow {
  session_id: string
  session_name: string
  session_date: string
  scheduled_at: string
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
  registrationsFromParticipants?: boolean  // true = registered_count taken from participant rows
  attendanceStatus?: 'populated' | 'not_populated'
  purchaseMappingStatus?: 'mapped' | 'not_mapped_yet'
  source: 'view' | 'raw_tables' | 'none'
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
  // Primary: use the aggregated view
  const { data: viewData, error: viewError } = await supabase
    .from('v_webinar_jsu_funnel_by_session')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(12)

  if (viewError) {
    console.warn('v_webinar_jsu_funnel_by_session unavailable:', viewError.message)
  }

  const viewRows = (viewData ?? []) as JsuFunnelRow[]

  if (viewRows.length > 0) {
    // Check if view shows 0 registrations (common when registered_count column is not populated)
    const viewTotalRegistered = viewRows.reduce((s, r) => s + (r.registered_count ?? 0), 0)

    // Always get participant count to know if raw data exists
    const { count: partCount } = await supabase
      .from('webinar_participants')
      .select('*', { count: 'exact', head: true })

    if (viewTotalRegistered === 0 && (partCount ?? 0) > 0) {
      // View has sessions but 0 registered_count — participants exist but aren't counted.
      // Fall through to raw tables path for accurate per-session registration counts.
      console.log('GIENIU webinar: view shows 0 registrations with', partCount, 'participant rows — using raw tables for accurate counts')
      // (fall through to raw tables below)
    } else {
      const s = buildSummary(viewRows)
      const debug: JsuFunnelDebug = {
        sessionsCount: viewRows.length,
        participantsCount: partCount ?? 0,
        source: 'view',
        latestSessionDate: viewRows[0]?.session_date,
        latestSessionName: viewRows[0]?.session_name,
        attendanceStatus: s.totals.attendees > 0 ? 'populated' : 'not_populated',
        purchaseMappingStatus: s.totals.purchases > 0 ? 'mapped' : 'not_mapped_yet',
      }
      s._debug = debug
      console.log('GIENIU data sources', { webinarRows: viewRows.length, participants: partCount, source: 'view', hasClickMeeting: s.hasClickMeetingData, hasEmail: s.hasEmailData })
      return s
    }
  }

  // Fallback: query raw webinar_sessions + webinar_participants tables directly
  const [{ data: rawSessions, error: sessErr }, { data: rawParticipants, error: partErr }] = await Promise.all([
    supabase.from('webinar_sessions').select('*').order('scheduled_at', { ascending: false }).limit(12),
    supabase
      .from('webinar_participants')
      .select('id, session_id, email, registered_at, registration_date, attended, attend_duration_min, purchased_at, purchase_value, wix_order_id, created_at')
      .limit(500),
  ])

  if (sessErr) console.warn('webinar_sessions error:', sessErr.message)
  if (partErr) console.warn('webinar_participants error:', partErr.message)

  type RawSession = {
    id: string
    session_name?: string
    product_tag?: string
    scheduled_at?: string
    ended_at?: string
    registered_count?: number
    attendee_count?: number
  }
  type RawParticipant = {
    id?: string
    session_id: string
    email?: string | null
    registered_at?: string | null
    registration_date?: string | null
    attended?: boolean
    attend_duration_min?: number | null
    purchased_at?: string | null
    purchase_value?: number | null
    wix_order_id?: string | null
    created_at?: string | null
  }

  const sessions        = (rawSessions      ?? []) as RawSession[]
  const rawPartRows     = (rawParticipants   ?? []) as RawParticipant[]

  // Normalize emails and extract registration dates from potentially malformed fields
  const participantRows = rawPartRows.map(p => {
    const { email, registered_at } = normalizeParticipantFields({
      email: p.email,
      registered_at: p.registered_at,
      registration_date: p.registration_date,
      created_at: p.created_at,
    })
    return { ...p, email, registered_at }
  })

  // Count unique valid emails
  const uniqueEmails = new Set(
    participantRows
      .map(p => p.email?.toLowerCase() ?? '')
      .filter(e => e.includes('@'))
  ).size

  if (sessions.length === 0 && participantRows.length === 0) {
    console.log('GIENIU data sources', { webinarRows: 0, source: 'none', sessErr: sessErr?.message, partErr: partErr?.message })
    const empty = buildEmptySummary(sessErr?.message || partErr?.message)
    empty._debug = { sessionsCount: 0, participantsCount: 0, source: 'none', lastError: sessErr?.message || partErr?.message }
    return empty
  }

  // Aggregate from raw tables
  // Use participant count per session as registered_count fallback when column is 0/null
  const registeredFromSessions = sessions.reduce((s, r) => s + (r.registered_count ?? 0), 0)
  const registered = registeredFromSessions > 0 ? registeredFromSessions : participantRows.length
  const registrationsFromParticipants = registeredFromSessions === 0 && participantRows.length > 0

  const attendeesFromSessions = sessions.reduce((s, r) => s + (r.attendee_count ?? 0), 0)
  const attendeesFromParticipants = participantRows.filter(p => p.attended).length
  const attendees = attendeesFromSessions > 0 ? attendeesFromSessions : attendeesFromParticipants

  const purchases  = participantRows.filter(p => p.purchased_at || p.wix_order_id).length
  const revenue    = participantRows.reduce((s, p) => s + (p.purchase_value ?? 0), 0)

  const hasClickMeetingData = registered > 0 || attendees > 0 || sessions.length > 0
  const attendanceRate  = registered > 0 && attendees > 0 ? attendees  / registered : null
  const purchaseRate    = attendees   > 0                  ? purchases  / attendees  : null

  // Build synthetic JsuFunnelRows from raw sessions
  const syntheticRows: JsuFunnelRow[] = sessions.map(s => {
    const sessParticipants = participantRows.filter(p => p.session_id === s.id)
    const sessPurchases    = sessParticipants.filter(p => p.purchased_at || p.wix_order_id)
    const sessRevenue      = sessParticipants.reduce((acc, p) => acc + (p.purchase_value ?? 0), 0)
    const sessAttendees    = sessParticipants.filter(p => p.attended).length

    // registered_count: prefer session column if > 0, else count participant rows for this session
    const sessRegistered = (s.registered_count ?? 0) > 0
      ? s.registered_count!
      : sessParticipants.length

    // attendee_count: prefer session column if > 0, else count attended participant rows
    const sessAttendeeCount = (s.attendee_count ?? 0) > 0 ? s.attendee_count! : sessAttendees

    const sessAttRate = sessRegistered > 0 && sessAttendeeCount > 0
      ? Math.round((sessAttendeeCount / sessRegistered) * 100)
      : null
    const sessPurchRate = sessAttendeeCount > 0 && sessPurchases.length > 0
      ? Math.round((sessPurchases.length / sessAttendeeCount) * 100)
      : null

    return {
      session_id:          s.id,
      session_name:        s.session_name ?? s.id,
      session_date:        s.scheduled_at?.slice(0, 10) ?? '',
      scheduled_at:        s.scheduled_at ?? '',
      registered_count:    sessRegistered,
      attendee_count:      sessAttendeeCount,
      attendance_rate_pct: sessAttRate,
      purchases:           sessPurchases.length,
      revenue:             sessRevenue,
      purchase_rate_pct:   sessPurchRate,
      email_sent:      0,
      email_delivered: 0,
      email_opens:     0,
      email_clicks:    0,
    }
  })

  const totals: FunnelTotals = {
    email_sent: 0, email_delivered: 0, email_opens: 0, email_clicks: 0,
    registered, attendees, purchases, revenue,
  }
  const rates: FunnelRates = {
    delivery_rate: null, open_rate: null, click_rate: null, reg_rate: null,
    attendance_rate: attendanceRate,
    purchase_rate:   purchaseRate,
  }

  const { bottleneck, diagnosis } = diagnose(totals, rates, false, hasClickMeetingData)

  console.log('GIENIU data sources', { rawSessions: sessions.length, participants: participantRows.length, registered, attendees, purchases, uniqueEmails, source: 'raw_tables', registrationsFromParticipants })

  return {
    sessions: syntheticRows,
    hasEmailData: false,
    hasClickMeetingData,
    bottleneck,
    diagnosis,
    totals,
    rates,
    _debug: {
      sessionsCount: sessions.length,
      participantsCount: participantRows.length,
      uniqueEmails,
      registrationsFromParticipants,
      source: 'raw_tables',
      latestSessionDate: sessions[0]?.scheduled_at?.slice(0, 10),
      latestSessionName: sessions[0]?.session_name,
      attendanceStatus: attendees > 0 ? 'populated' : 'not_populated',
      purchaseMappingStatus: purchases > 0 ? 'mapped' : 'not_mapped_yet',
    },
  }
}

export async function loadJsuParticipantJourney(
  sessionId?: string
): Promise<JsuParticipantRow[]> {
  // Try view first
  const base = supabase
    .from('v_webinar_jsu_participant_journey')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(200)

  const { data, error } = await (sessionId ? base.eq('session_id', sessionId) : base)

  if (error) {
    console.warn('v_webinar_jsu_participant_journey unavailable:', error.message)
    return loadJsuParticipantsRaw(sessionId)
  }

  const rows = (data ?? []) as JsuParticipantRow[]

  // If view returned nothing, try raw table fallback
  if (rows.length === 0) {
    const rawRows = await loadJsuParticipantsRaw(sessionId)
    if (rawRows.length > 0) {
      console.log('GIENIU: participant view empty — using raw table, found', rawRows.length, 'rows')
      return rawRows
    }
    return []
  }

  // Normalize emails in case of malformed data from Make
  return rows.map(row => {
    const rawEmail = String(row.email ?? '')
    const cleanEmail = extractEmail(rawEmail)
    const regAt = row.registered_at
      ?? extractRegistrationDate(rawEmail)
      ?? null
    return {
      ...row,
      email: cleanEmail || rawEmail,
      registered_at: regAt,
    }
  })
}

async function loadJsuParticipantsRaw(sessionId?: string): Promise<JsuParticipantRow[]> {
  let query = supabase
    .from('webinar_participants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (sessionId) query = query.eq('session_id', sessionId)

  const { data, error } = await query

  if (error) {
    console.warn('webinar_participants raw query error:', error.message)
    return []
  }

  return ((data ?? []) as Record<string, unknown>[]).map(r => {
    const rawEmail = String(r.email ?? '')
    const { email, registered_at } = normalizeParticipantFields({
      email: rawEmail,
      registered_at: r.registered_at as string | null,
      registration_date: r.registration_date as string | null,
      created_at: r.created_at as string | null,
    })

    return {
      participant_id:      String(r.id ?? r.participant_id ?? String(Math.random())),
      session_id:          String(r.session_id ?? ''),
      email,
      session_date:        String(r.session_date ?? registered_at?.slice(0, 10) ?? ''),
      session_name:        String(r.session_name ?? ''),
      registered_at,
      attended:            Boolean(r.attended ?? false),
      attend_duration_min: (r.attend_duration_min as number | null) ?? null,
      purchased_at:        (r.purchased_at as string | null) ?? null,
      purchase_value:      (r.purchase_value as number | null) ?? null,
      wix_order_id:        (r.wix_order_id as string | null) ?? null,
    }
  })
}

// ── Diagnosis engine ─────────────────────────────────────────────────────────

function buildEmptySummary(reason = ''): JsuFunnelSummary {
  return {
    sessions: [],
    hasEmailData: false,
    hasClickMeetingData: false,
    bottleneck: 'NO_DATA',
    diagnosis: reason || 'No JSU webinar sessions in Supabase yet.',
    totals: { email_sent: 0, email_delivered: 0, email_opens: 0, email_clicks: 0, registered: 0, attendees: 0, purchases: 0, revenue: 0 },
    rates: { delivery_rate: null, open_rate: null, click_rate: null, reg_rate: null, attendance_rate: null, purchase_rate: null },
  }
}

function buildSummary(sessions: JsuFunnelRow[]): JsuFunnelSummary {
  if (sessions.length === 0) {
    return buildEmptySummary()
  }

  const recent = sessions.slice(0, 8)

  const totals: FunnelTotals = {
    email_sent:      sum(recent, r => r.email_sent),
    email_delivered: sum(recent, r => r.email_delivered),
    email_opens:     sum(recent, r => r.email_opens),
    email_clicks:    sum(recent, r => r.email_clicks),
    registered:      sum(recent, r => r.registered_count),
    attendees:       sum(recent, r => r.attendee_count),
    purchases:       sum(recent, r => r.purchases),
    revenue:         sum(recent, r => r.revenue),
  }

  const hasEmailData = totals.email_sent > 0
  const hasClickMeetingData = sessions.length > 0 || totals.registered > 0 || totals.attendees > 0

  const rates: FunnelRates = {
    delivery_rate:  hasEmailData && totals.email_sent > 0
      ? totals.email_delivered / totals.email_sent : null,
    open_rate:      hasEmailData && totals.email_delivered > 0
      ? totals.email_opens / totals.email_delivered : null,
    click_rate:     hasEmailData && totals.email_delivered > 0
      ? totals.email_clicks / totals.email_delivered : null,
    reg_rate:       hasEmailData && totals.email_clicks > 0
      ? totals.registered / totals.email_clicks : null,
    attendance_rate: hasClickMeetingData && totals.registered > 0
      ? totals.attendees / totals.registered : null,
    purchase_rate:  hasClickMeetingData && totals.attendees > 0
      ? totals.purchases / totals.attendees : null,
  }

  const { bottleneck, diagnosis } = diagnose(totals, rates, hasEmailData, hasClickMeetingData)

  return { sessions, hasEmailData, hasClickMeetingData, bottleneck, diagnosis, totals, rates }
}

function diagnose(
  t: FunnelTotals,
  r: FunnelRates,
  hasEmail: boolean,
  hasClickMeeting: boolean
): { bottleneck: FunnelBottleneck; diagnosis: string } {

  if (!hasEmail && !hasClickMeeting) {
    return {
      bottleneck: 'NO_SOURCES',
      diagnosis:
        'No email or ClickMeeting data yet. ' +
        'Connect Make scenarios — see docs/clickmeeting_make_scenarios.md. ' +
        'Without this data I cannot determine where the bottleneck is.',
    }
  }

  if (hasEmail && r.delivery_rate !== null && r.delivery_rate < 0.85) {
    return {
      bottleneck: 'DELIVERABILITY',
      diagnosis:
        `Delivery rate is ${pct(r.delivery_rate)} — below the 85% benchmark. ` +
        'This is a sender reputation, list quality, or domain issue. ' +
        'Check: ESP dashboard (MailerLite/AC), SPF/DKIM/DMARC records, hard bounce rate.',
    }
  }

  if (hasEmail && r.open_rate !== null && r.open_rate < 0.15) {
    return {
      bottleneck: 'OPENS',
      diagnosis:
        `Open rate is ${pct(r.open_rate)} — WCEEN baseline is 20–30%. ` +
        'Subject line is not landing, or emails are going to spam or promotions. ' +
        'Check: personalised subject, list fatigue, sending time.',
    }
  }

  if (hasEmail && r.click_rate !== null && r.click_rate < 0.02) {
    return {
      bottleneck: 'CLICKS',
      diagnosis:
        `Click rate is ${pct(r.click_rate)} — below 2% of delivered. ` +
        'People open but do not click. The CTA is not converting. ' +
        'Check: single prominent CTA button, value proposition copy, link works.',
    }
  }

  if (hasEmail && hasClickMeeting && r.reg_rate !== null && r.reg_rate < 0.05) {
    return {
      bottleneck: 'REGISTRATIONS',
      diagnosis:
        `Click-to-registration rate is ${pct(r.reg_rate)} — below 5%. ` +
        'People click the email but do not register for the webinar. ' +
        'Check: webinar landing page, ClickMeeting registration form, page load speed.',
    }
  }

  if (hasClickMeeting && r.attendance_rate !== null && r.attendance_rate < 0.60) {
    return {
      bottleneck: 'ATTENDANCE',
      diagnosis:
        `Webinar attendance is ${pct(r.attendance_rate)} — below 60%. ` +
        'People register but do not show up. ' +
        'Check: reminder sequence (email 24h + 1h before), Thursday 18:00 slot, ' +
        'confirmation page shows the correct date and time.',
    }
  }

  if (hasClickMeeting && r.purchase_rate !== null && r.purchase_rate < 0.03) {
    const possiblyMapping = t.attendees > 5 && t.purchases === 0
    if (possiblyMapping) {
      return {
        bottleneck: 'PRODUCT_MAPPING',
        diagnosis:
          `${t.attendees} attendees, zero purchases in the system. ` +
          'This looks like a product mapping issue: verify that "Jak się uczyć" orders (549 PLN) ' +
          'in Wix are being matched by Make to webinar_participants ' +
          '(match by email, 7-day window after the webinar).',
      }
    }
    return {
      bottleneck: 'PURCHASE_PITCH',
      diagnosis:
        `Attendee-to-purchase conversion is ${pct(r.purchase_rate)} — below 3%. ` +
        'People attend but do not buy. ' +
        'Check: offer at the end of the webinar, pitch length, purchase page, ' +
        '24h/48h/72h follow-up sequence, whether the replay gets its own offer.',
    }
  }

  if (!hasEmail) {
    // Attendance populated?
    if (hasClickMeeting && t.registered > 0 && t.attendees === 0) {
      return {
        bottleneck: 'OK',
        diagnosis:
          `${t.registered} registration${t.registered > 1 ? 's' : ''} found in ClickMeeting. ` +
          'Attendance data is not populated yet — the webinar may not have taken place or the attend column has not been synced. ' +
          'Purchases are not mapped yet. ' +
          'Connect Make → ESP to enable full email funnel diagnosis.',
      }
    }
    return {
      bottleneck: 'OK',
      diagnosis:
        'No email data yet, so deliverability, open rate, and click rate cannot be diagnosed. ' +
        'ClickMeeting looks OK. Connect Make → ESP to enable full diagnosis.',
    }
  }

  if (!hasClickMeeting) {
    return {
      bottleneck: 'OK',
      diagnosis:
        'No ClickMeeting data yet, so registrations and attendance cannot be diagnosed. ' +
        'Email funnel looks OK. Connect Make → ClickMeeting for a complete picture.',
    }
  }

  return {
    bottleneck: 'OK',
    diagnosis:
      'Funnel looks healthy at every stage. ' +
      'Possible causes: past buyers have already purchased the course (no new candidates), ' +
      'insufficient new traffic into the funnel, or seasonality. Check list segmentation.',
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sum(rows: JsuFunnelRow[], fn: (r: JsuFunnelRow) => number): number {
  return rows.reduce((acc, r) => acc + (fn(r) ?? 0), 0)
}

export function pct(rate: number | null, decimals = 1): string {
  if (rate == null) return '—'
  return (rate * 100).toFixed(decimals) + '%'
}

export function fmtPlnFunnel(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
}
