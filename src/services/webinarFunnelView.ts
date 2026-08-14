// v_webinar_funnel — the single source of truth for webinar session numbers.
//
// The old path joined webinar_attendance on webinar_id, which is NULL on every
// row since the FK to webinars was dropped; the join matched nothing and the
// panel showed no attendance at all. The correct key is
// clickmeeting_room_id + clickmeeting_session_id, and the view already applies
// it. Nothing in this module joins on webinar_id.

import { supabase } from './supabase'
import { bustUrl } from '../utils/cacheBust'

export interface FunnelViewRow {
  session_name: string
  product_tag: string | null
  clickmeeting_room_id: string
  clickmeeting_session_id: string
  session_started_at: string
  registered: number | null
  attendees: number | null
  avg_minutes: number | null
  buyers: number | null
  revenue_7d: number | null
}

export interface FunnelViewResult {
  rows: FunnelViewRow[]
  error: string | null
}

export async function fetchWebinarFunnelView(limit = 200): Promise<FunnelViewResult> {
  try {
    const { data, error } = await supabase
      .from('v_webinar_funnel')
      .select('*')
      .order('session_started_at', { ascending: false })
      .limit(limit)
    if (error) return { rows: [], error: error.message }
    return { rows: (data ?? []) as FunnelViewRow[], error: null }
  } catch (err) {
    return { rows: [], error: String((err as Error)?.message ?? err) }
  }
}

// ── show-up rate ────────────────────────────────────────────────────────────
// Registration data is incomplete: in most sessions MORE people attended than
// registered. A ratio over an untrustworthy denominator is not a rate, so it is
// never rendered as one — the caller shows "?" instead.

export type ShowUp =
  | { kind: 'pct'; value: number }
  | { kind: 'unreliable'; reason: string }
  | { kind: 'unknown' }

export function showUpRate(registered: number | null, attendees: number | null): ShowUp {
  if (registered == null || attendees == null || registered <= 0) return { kind: 'unknown' }
  if (attendees > registered) return { kind: 'unreliable', reason: 'rejestracje niekompletne' }
  return { kind: 'pct', value: Math.round((attendees / registered) * 100) }
}

// ── attendee drill-down ─────────────────────────────────────────────────────

export interface AttendeeRow {
  email_masked: string
  login: string | null
  attended: boolean
  minutes: number | null
  bought7d: boolean
  bought_amount: number
  bought_at: string | null
}

export interface AttendeesResult {
  ok: boolean
  /** false = no rows in webinar_attendance for this session → "brak danych", not zero. */
  hasData: boolean
  attendees: AttendeeRow[]
  buyers: number
  error: string | null
}

export async function fetchSessionAttendees(room: string, session: string): Promise<AttendeesResult> {
  try {
    const res = await fetch(
      bustUrl(`/.netlify/functions/webinar-attendees?room=${encodeURIComponent(room)}&session=${encodeURIComponent(session)}`),
      { headers: { 'Cache-Control': 'no-store' } },
    )
    if (!res.ok) return { ok: false, hasData: false, attendees: [], buyers: 0, error: `HTTP ${res.status}` }
    const j = await res.json()
    return {
      ok: !!j.ok,
      hasData: !!j.hasData,
      attendees: (j.attendees ?? []) as AttendeeRow[],
      buyers: j.buyers ?? 0,
      error: j.error ?? null,
    }
  } catch (err) {
    return { ok: false, hasData: false, attendees: [], buyers: 0, error: String((err as Error)?.message ?? err) }
  }
}
