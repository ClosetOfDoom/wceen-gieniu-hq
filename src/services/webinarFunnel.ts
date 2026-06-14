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
  const { data, error } = await supabase
    .from('v_webinar_jsu_funnel_by_session')
    .select('*')
    .order('scheduled_at', { ascending: false })
    .limit(12)

  if (error) {
    console.warn('v_webinar_jsu_funnel_by_session unavailable:', error.message)
    return buildEmptySummary('Widok Supabase niedostępny — uruchom najpierw webinar_funnel_schema.sql.')
  }

  return buildSummary((data ?? []) as JsuFunnelRow[])
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
    diagnosis: reason || 'Brak sesji webinarowych JSU w Supabase.',
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
        'Nie mam jeszcze danych z mailingu ani z ClickMeeting. ' +
        'Podłącz scenariusze Make (patrz: docs/clickmeeting_make_scenarios.md). ' +
        'Bez tych danych nie rozstrzygam gdzie leży problem.',
    }
  }

  if (hasEmail && r.delivery_rate !== null && r.delivery_rate < 0.85) {
    return {
      bottleneck: 'DELIVERABILITY',
      diagnosis:
        `Wskaźnik dostarczalności wynosi ${pct(r.delivery_rate)} — poniżej normy 85%. ` +
        'To problem z reputacją nadawcy, listą (zbyt wielu bounców/spam traps) lub domeną. ' +
        'Sprawdź: wyniki w ESP (MailerLite/AC), rekordy SPF/DKIM/DMARC, odsetek twardych bounców.',
    }
  }

  if (hasEmail && r.open_rate !== null && r.open_rate < 0.15) {
    return {
      bottleneck: 'OPENS',
      diagnosis:
        `Open rate wynosi ${pct(r.open_rate)} — norma dla bazy WCEEN to 20–30%. ` +
        'Problem: temat maila nie przyciąga albo maile lądują w spamie/promocjach. ' +
        'Sprawdź: czy temat personalizowany, czy baza nie jest przesycona, czy godzina wysyłki jest ok.',
    }
  }

  if (hasEmail && r.click_rate !== null && r.click_rate < 0.02) {
    return {
      bottleneck: 'CLICKS',
      diagnosis:
        `Click rate wynosi ${pct(r.click_rate)} — poniżej 2% z dostarczonych. ` +
        'Otwierają, ale CTA nie konwertuje. ' +
        'Sprawdź: jeden wyraźny przycisk CTA, copy propozycji wartości webinaru, link działa.',
    }
  }

  if (hasEmail && hasClickMeeting && r.reg_rate !== null && r.reg_rate < 0.05) {
    return {
      bottleneck: 'REGISTRATIONS',
      diagnosis:
        `Konwersja klik → rejestracja na webinar wynosi ${pct(r.reg_rate)} — poniżej 5%. ` +
        'Klikają w maila, ale nie rejestrują się. ' +
        'Sprawdź: landing strona webinaru, formularz rejestracji ClickMeeting, prędkość ładowania.',
    }
  }

  if (hasClickMeeting && r.attendance_rate !== null && r.attendance_rate < 0.60) {
    return {
      bottleneck: 'ATTENDANCE',
      diagnosis:
        `Frekwencja na webinarze wynosi ${pct(r.attendance_rate)} — poniżej 60%. ` +
        'Rejestrują się, ale nie przychodzą. ' +
        'Sprawdź: sekwencja przypomnień (email 24h + 1h przed), godzina 18:00 czwartek, ' +
        'landing po rejestracji potwierdza datę i czas.',
    }
  }

  if (hasClickMeeting && r.purchase_rate !== null && r.purchase_rate < 0.03) {
    const possiblyMapping = t.attendees > 5 && t.purchases === 0
    if (possiblyMapping) {
      return {
        bottleneck: 'PRODUCT_MAPPING',
        diagnosis:
          `${t.attendees} uczestników, zero zakupów w systemie. ` +
          'To może być problem mapowania produktu: sprawdź, czy zamówienia "Jak się uczyć" ' +
          '(549 zł) w Wix są prawidłowo dopasowywane przez Make do tabeli webinar_participants ' +
          '(dopasowanie po emailu, okno 7 dni po webinarze).',
      }
    }
    return {
      bottleneck: 'PURCHASE_PITCH',
      diagnosis:
        `Konwersja uczestnik → zakup wynosi ${pct(r.purchase_rate)} — poniżej 3%. ` +
        'Przychodzą na webinar, ale nie kupują. ' +
        'Sprawdź: oferta na końcu webinaru, czas trwania pitcha, strona zakupu, follow-up ' +
        '24h/48h/72h po webinarze, czy replay dostaje osobną ofertę.',
    }
  }

  if (!hasEmail) {
    return {
      bottleneck: 'OK',
      diagnosis:
        'Nie mam jeszcze danych z mailingu, więc nie rozstrzygam deliverability ani open/click rate. ' +
        'ClickMeeting wygląda OK. Podłącz Make → ESP aby pełna diagnoza była możliwa.',
    }
  }

  if (!hasClickMeeting) {
    return {
      bottleneck: 'OK',
      diagnosis:
        'Nie mam jeszcze danych z ClickMeeting, więc nie rozstrzygam zapisów i obecności. ' +
        'Email funnel wygląda OK. Podłącz Make → ClickMeeting aby diagnoza była kompletna.',
    }
  }

  return {
    bottleneck: 'OK',
    diagnosis:
      'Funnel wygląda sprawnie na każdym etapie. ' +
      'Możliwe: kurs nie sprzedaje się od tygodnia bo poprzedni kupujący nie wrócili (LTV), ' +
      'brak nowego ruchu do lejka lub sezonowość. Sprawdź segmentację bazy.',
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

export function fmtZlFunnel(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'
}
