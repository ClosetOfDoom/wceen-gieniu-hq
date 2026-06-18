import { supabase } from './supabase'

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
  session_id: string          // exposed by view — used for optional drill-down filter
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
  delivery_rate: number | null    // delivered / sent
  open_rate: number | null        // opens / delivered
  click_rate: number | null       // clicks / delivered
  reg_rate: number | null         // registered / clicks (if email data exists)
  attendance_rate: number | null  // attendees / registered
  purchase_rate: number | null    // purchases / attendees
}

export interface JsuFunnelSummary {
  sessions: JsuFunnelRow[]
  hasEmailData: boolean
  hasClickMeetingData: boolean
  bottleneck: FunnelBottleneck
  diagnosis: string
  totals: FunnelTotals
  rates: FunnelRates
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
    const s = buildSummary(viewRows)
    console.log('GIENIU data sources', { webinarRows: viewRows.length, source: 'view', hasClickMeeting: s.hasClickMeetingData, hasEmail: s.hasEmailData })
    return s
  }

  // Fallback: query raw webinar_sessions + webinar_participants tables directly
  // This handles cases where the view exists but email joins return 0 rows.
  const [{ data: rawSessions, error: sessErr }, { data: rawParticipants, error: partErr }] = await Promise.all([
    supabase.from('webinar_sessions').select('*').order('scheduled_at', { ascending: false }).limit(12),
    supabase.from('webinar_participants').select('session_id, attended, attend_duration_min, purchased_at, purchase_value, wix_order_id').limit(500),
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
    session_id: string
    attended?: boolean
    attend_duration_min?: number | null
    purchased_at?: string | null
    purchase_value?: number | null
    wix_order_id?: string | null
  }

  const sessions      = (rawSessions      ?? []) as RawSession[]
  const participantRows = (rawParticipants ?? []) as RawParticipant[]

  if (sessions.length === 0 && participantRows.length === 0) {
    console.log('GIENIU data sources', { webinarRows: 0, source: 'none' })
    return buildEmptySummary()
  }

  // Aggregate from raw tables
  const registered = sessions.reduce((s, r) => s + (r.registered_count ?? 0), 0)
  const attendees  = sessions.reduce((s, r) => s + (r.attendee_count  ?? 0), 0)
  const purchases  = participantRows.filter(p => p.purchased_at || p.wix_order_id).length
  const revenue    = participantRows.reduce((s, p) => s + (p.purchase_value ?? 0), 0)

  const hasClickMeetingData = registered > 0 || attendees > 0 || sessions.length > 0
  const attendanceRate  = registered > 0 ? attendees  / registered : null
  const purchaseRate    = attendees   > 0 ? purchases  / attendees  : null

  // Build synthetic JsuFunnelRows from raw sessions
  const syntheticRows: JsuFunnelRow[] = sessions.map(s => {
    const sessParticipants = participantRows.filter(p => p.session_id === s.id)
    const sessPurchases    = sessParticipants.filter(p => p.purchased_at || p.wix_order_id)
    const sessRevenue      = sessParticipants.reduce((acc, p) => acc + (p.purchase_value ?? 0), 0)
    return {
      session_id:          s.id,
      session_name:        s.session_name ?? s.id,
      session_date:        s.scheduled_at?.slice(0, 10) ?? '',
      scheduled_at:        s.scheduled_at ?? '',
      registered_count:    s.registered_count ?? 0,
      attendee_count:      s.attendee_count   ?? 0,
      attendance_rate_pct: s.registered_count ? Math.round((s.attendee_count ?? 0) / s.registered_count * 100) : null,
      purchases:           sessPurchases.length,
      revenue:             sessRevenue,
      purchase_rate_pct:   s.attendee_count ? Math.round(sessPurchases.length / s.attendee_count * 100) : null,
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

  console.log('GIENIU data sources', { rawSessions: sessions.length, participants: participantRows.length, registered, attendees, purchases, source: 'raw_tables' })

  return {
    sessions: syntheticRows,
    hasEmailData: false,
    hasClickMeetingData,
    bottleneck,
    diagnosis,
    totals,
    rates,
  }
}

export async function loadJsuParticipantJourney(
  sessionId?: string
): Promise<JsuParticipantRow[]> {
  const base = supabase
    .from('v_webinar_jsu_participant_journey')
    .select('*')
    .order('session_date', { ascending: false })
    .limit(200)

  const { data, error } = await (sessionId ? base.eq('session_id', sessionId) : base)

  if (error) {
    console.warn('v_webinar_jsu_participant_journey unavailable:', error.message)
    return []
  }

  return (data ?? []) as JsuParticipantRow[]
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
  const hasClickMeetingData = totals.registered > 0 || totals.attendees > 0

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
