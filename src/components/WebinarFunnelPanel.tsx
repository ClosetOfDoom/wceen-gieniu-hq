import { useState, Fragment, type CSSProperties } from 'react'
import type { JsuFunnelSummary, JsuFunnelRow, JsuParticipantRow, FunnelBottleneck, JsuFunnelDebug } from '../services/webinarFunnel'
import { pct, fmtPlnFunnel } from '../services/webinarFunnel'
import { ParticipantJourneyTable } from './ParticipantJourneyTable'
import type { JsuCommandKey } from '../brain/responses'
import { normalizeProduct, type ProductTag } from '../lib/webinarProduct'

// SINGLE SOURCE OF TRUTH: webinar_sessions.product_tag (no session_name parsing).
function tagOf(s: { product_tag?: string | null }): ProductTag {
  return normalizeProduct({ product_tag: s.product_tag }).canonicalTag
}

interface Props {
  summary: JsuFunnelSummary | null
  participants: JsuParticipantRow[]
  participantsLoading: boolean
  loading: boolean
  onCommand: (key: JsuCommandKey) => void
  gieniuResponse: string
}

// Semantic accent colours — theme-agnostic (saturated, readable on cream and on
// forest-dark). Neutrals (backgrounds, borders, muted text) use CSS theme tokens
// so this panel follows the active light/dark theme like the rest of the app.
const BOTTLENECK_COLOR: Record<FunnelBottleneck, string> = {
  NO_DATA:         'var(--muted2)',
  NO_SOURCES:      'var(--muted)',
  DELIVERABILITY:  'var(--orange)',
  OPENS:           'var(--orange)',
  CLICKS:          'var(--orange)',
  REGISTRATIONS:   'var(--orange)',
  ATTENDANCE:      'var(--amber)',
  PURCHASE_PITCH:  'var(--orange)',
  PRODUCT_MAPPING: 'var(--red)',
  OK:              'var(--emerald)',
}

const BOTTLENECK_LABEL: Record<FunnelBottleneck, string> = {
  NO_DATA:         'NO DATA',
  NO_SOURCES:      'NO SOURCES',
  DELIVERABILITY:  'DELIVERABILITY',
  OPENS:           'OPEN RATE',
  CLICKS:          'CLICK RATE',
  REGISTRATIONS:   'REGISTRATIONS',
  ATTENDANCE:      'ATTENDANCE',
  PURCHASE_PITCH:  'PITCH / OFFER',
  PRODUCT_MAPPING: 'PRODUCT MAPPING',
  OK:              'OK',
}

const JSU_COMMANDS: { key: JsuCommandKey; label: string }[] = [
  { key: 'webinar jak się uczyć',        label: 'JSU — Report' },
  { key: 'czemu kurs się nie sprzedaje', label: 'Why Not Selling?' },
  { key: 'funnel JSU',                   label: 'JSU Funnel' },
  { key: 'porównaj webinary JSU',        label: 'Compare Webinars' },
  { key: 'deliverability',               label: 'Deliverability' },
  { key: 'czy mailing siadł',            label: 'Mailing Crashed?' },
  { key: 'attendance rate',              label: 'Attendance Rate' },
  { key: 'kto był i kupił',              label: 'Who Attended & Bought' },
]

function FunnelStep({
  label, value, rate, rateLabel, missing, notPopulated, notMapped,
}: {
  label: string
  value: number | string
  rate?: number | null
  rateLabel?: string
  missing?: boolean
  notPopulated?: boolean
  notMapped?: boolean
}) {
  const dim = missing || notPopulated || notMapped
  const statusText = notPopulated ? 'not populated' : notMapped ? 'not mapped yet' : null

  return (
    <div style={{
      flex: '1 1 100px',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      padding: '10px 12px',
      minWidth: '90px',
    }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: missing ? '1rem' : '1.3rem', fontWeight: 700, color: dim ? 'var(--muted2)' : 'var(--text)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
        {missing ? '—' : value}
      </div>
      {statusText && (
        <div style={{ fontSize: '0.62rem', color: 'var(--muted2)', marginTop: '3px', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
          {statusText}
        </div>
      )}
      {rate !== undefined && !notPopulated && !notMapped && (
        <div style={{ fontSize: '0.68rem', color: missing ? 'var(--muted2)' : 'var(--muted)', marginTop: '3px', fontFamily: 'var(--font-mono)' }}>
          {missing ? '—' : (rate != null ? pct(rate) : '—')} {rateLabel ?? ''}
        </div>
      )}
    </div>
  )
}

function ClickMeetingStatus({ debug }: { debug?: JsuFunnelDebug }) {
  if (debug && (debug.sessionsCount > 0 || debug.participantsCount > 0)) {
    return (
      <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
        <div style={{ color: 'var(--amber)', fontWeight: 700, marginBottom: '4px' }}>ClickMeeting sessions found</div>
        {debug.sessionsCount > 0 && <div>✓ Sessions in DB: <span style={{ color: 'var(--text)' }}>{debug.sessionsCount}</span></div>}
        {debug.participantsCount > 0 && <div>✓ Participants in DB: <span style={{ color: 'var(--text)' }}>{debug.participantsCount}</span></div>}
        {debug.sessionsCount > 0 && debug.participantsCount === 0 && <div style={{ color: 'var(--orange)' }}>⚠ No participant rows yet — Make may still be syncing</div>}
        <div style={{ marginTop: '4px', color: 'var(--muted2)', fontSize: '0.7rem' }}>Email/ESP data missing — deliverability not assessable.</div>
      </div>
    )
  }
  return (
    <div style={{ background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6 }}>
      No ClickMeeting data yet — registrations and attendance cannot be assessed.
      <br />
      Connect Make → ClickMeeting API → Supabase (webinar_sessions, webinar_participants).
    </div>
  )
}

function DataDebugBar({ debug }: { debug?: JsuFunnelDebug }) {
  if (!debug) return null
  return (
    <div style={{
      marginTop: '6px',
      padding: '5px 10px',
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: '4px',
      fontFamily: 'var(--font-mono)',
      fontSize: '0.64rem',
      color: 'var(--muted2)',
      display: 'flex',
      gap: '16px',
      flexWrap: 'wrap',
    }}>
      <span>data debug:</span>
      <span>source: <span style={{ color: debug.source === 'raw_tables' ? 'var(--emerald)' : 'var(--muted)' }}>{debug.source}</span></span>
      <span>sessions: <span style={{ color: debug.sessionsCount > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>{debug.sessionsCount}</span></span>
      <span>participants: <span style={{ color: debug.participantsCount > 0 ? 'var(--emerald)' : 'var(--orange)' }}>{debug.participantsCount}</span></span>
      {debug.rawParticipants != null && debug.rawParticipants !== debug.participantsCount && (
        <span>raw: <span style={{ color: debug.rawParticipants > 0 ? 'var(--amber)' : 'var(--muted2)' }}>{debug.rawParticipants}</span></span>
      )}
      {debug.uniqueEmails != null && <span>unique: <span style={{ color: debug.uniqueEmails > 0 ? 'var(--text)' : 'var(--muted2)' }}>{debug.uniqueEmails}</span></span>}
      {debug.hasMismatch && <span style={{ color: 'var(--orange)' }}>⚠ view mismatch: raw participants available</span>}
      {debug.registrationsFromParticipants && <span style={{ color: 'var(--amber)' }}>reg from participants ↑</span>}
      {debug.attendanceStatus === 'not_populated' && <span style={{ color: 'var(--orange)' }}>attendance: not populated</span>}
      {debug.purchaseMappingStatus === 'not_mapped_yet' && <span style={{ color: 'var(--muted2)' }}>purchases: not mapped</span>}
      {debug.latestSessionDate && <span>latest: <span style={{ color: 'var(--muted)' }}>{debug.latestSessionDate}{debug.latestSessionName ? ` / ${debug.latestSessionName.slice(0, 30)}` : ''}</span></span>}
      {debug.lastError && <span style={{ color: 'var(--orange)' }}>error: {debug.lastError.slice(0, 60)}</span>}
      <span style={{ color: 'var(--muted2)', marginLeft: 'auto' }}>schedule: Tue 18:00=JZK · Thu 18:00=JSU</span>
    </div>
  )
}

function SessionRow({ s, attendancePopulated, expanded, onToggle }: {
  s: JsuFunnelRow
  attendancePopulated: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const product = normalizeProduct({ product_tag: s.product_tag })
  const productColor = product.canonicalTag === 'JZK' ? 'var(--teal)' : product.canonicalTag === 'JSU' ? 'var(--gold)' : 'var(--muted2)'

  return (
    <tr
      onClick={onToggle}
      style={{ borderBottom: '1px solid var(--border)', fontSize: '0.73rem', fontFamily: 'var(--font-mono)', cursor: 'pointer', background: expanded ? 'var(--surface2)' : undefined }}
      title="Kliknij, aby rozwinąć listę uczestników"
    >
      <td style={{ padding: '5px 8px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        <span aria-hidden="true" style={{ color: expanded ? 'var(--gold)' : 'var(--muted2)', marginRight: 5 }}>{expanded ? '▾' : '▸'}</span>
        {s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : s.session_date}
      </td>
      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: '0.65rem', color: productColor, border: `1px solid var(--border)`, borderRadius: '3px', padding: '1px 5px' }}>
          {product.canonicalTag}
        </span>
        {product.reason.includes('overridden') && (
          <span style={{ marginLeft: '4px', fontSize: '0.6rem', color: 'var(--orange)' }} title={product.reason}>⚠</span>
        )}
      </td>
      <td style={{ padding: '5px 8px', color: 'var(--text2)', textAlign: 'right' }}>
        {s.registered_count > 0 ? s.registered_count : <span style={{ color: 'var(--muted2)' }}>—</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: attendancePopulated ? 'var(--text2)' : 'var(--muted2)' }}>
        {attendancePopulated
          ? (s.attendee_count > 0 ? s.attendee_count : '0')
          : <span style={{ fontSize: '0.66rem', color: 'var(--muted2)', fontStyle: 'italic' }}>n/p</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: attendancePopulated && s.attendance_rate_pct !== null && s.attendance_rate_pct < 60 ? 'var(--orange)' : 'var(--muted)' }}>
        {attendancePopulated && s.attendance_rate_pct != null
          ? s.attendance_rate_pct + '%'
          : <span style={{ fontSize: '0.66rem', color: 'var(--muted2)', fontStyle: 'italic' }}>n/p</span>}
      </td>
      {/* Sales = registrants who ordered AFTER this webinar (true conversions).
          JSU course (549) shown separately — the key efficacy metric.
          Pre-webinar customers (ordered before) are shown muted, never counted here. */}
      <td style={{ padding: '5px 8px', textAlign: 'right', color: s.purchases > 0 ? 'var(--emerald)' : 'var(--muted2)', fontWeight: s.purchases > 0 ? 700 : 400 }}>
        {s.purchases}
        {(s.jsu_course_sales ?? 0) > 0 && (
          <span style={{ marginLeft: 4, fontSize: '0.62rem', color: 'var(--gold)' }} title="JSU course sold after the webinar (549 PLN)">
            JSU {s.jsu_course_sales}
          </span>
        )}
        {(s.pre_webinar_count ?? 0) > 0 && (
          <div style={{ fontSize: '0.6rem', color: 'var(--muted2)', fontStyle: 'italic' }} title="Pre-webinar customers: ordered BEFORE the webinar — funnel entries, not conversions">
            +{s.pre_webinar_count} pre
          </div>
        )}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: s.revenue > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>
        {s.revenue > 0 ? s.revenue.toFixed(0) + ' PLN' : '—'}
        {(s.jsu_course_revenue ?? 0) > 0 && (
          <div style={{ fontSize: '0.62rem', color: 'var(--gold)' }} title="JSU course revenue after the webinar (549 PLN)">
            JSU {s.jsu_course_revenue!.toFixed(0)} PLN
          </div>
        )}
        {(s.pre_webinar_revenue ?? 0) > 0 && (
          <div style={{ fontSize: '0.6rem', color: 'var(--muted2)', fontStyle: 'italic' }} title="Pre-webinar revenue — not attributable to this webinar">
            {s.pre_webinar_revenue!.toFixed(0)} pre
          </div>
        )}
      </td>
    </tr>
  )
}

// Expanded participant list for one session: email, registration status, attendance
// status (brak danych vs present/absent), and any purchase (before/after phase).
function SessionParticipants({ rows }: { rows: JsuParticipantRow[] }) {
  if (rows.length === 0) {
    return <div style={{ padding: '10px 12px', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Brak zarejestrowanych uczestników dla tej sesji.</div>
  }
  const attCell = (st: JsuParticipantRow['attendance_status']) => {
    if (st === 'present') return <span style={{ color: 'var(--emerald)' }}>obecny</span>
    if (st === 'absent')  return <span style={{ color: 'var(--muted)' }}>nieobecny</span>
    // No row in webinar_attendance → we simply do not know. NOT "nie był".
    return <span style={{ color: 'var(--muted2)', fontStyle: 'italic' }} title="webinar_attendance nie ma wiersza — brak informacji, nie nieobecność">brak danych</span>
  }
  return (
    <div style={{ padding: '4px 8px 12px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', minWidth: '620px' }}>
        <thead>
          <tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
            <th style={{ padding: '3px 8px' }}>E-mail</th>
            <th style={{ padding: '3px 8px' }}>Rejestracja</th>
            <th style={{ padding: '3px 8px' }}>Obecność</th>
            <th style={{ padding: '3px 8px' }}>Kupił?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.participant_id} style={{ borderTop: '1px solid var(--border)', color: 'var(--text2)' }}>
              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{p.email}</td>
              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>
                {p.registered_at_missing || !p.registered_at
                  ? <span style={{ color: 'var(--amber)', fontStyle: 'italic' }} title="Kolumna registered_at jest null na wszystkich wierszach">brak pola: registered_at</span>
                  : new Date(p.registered_at).toLocaleString('pl-PL')}
              </td>
              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{attCell(p.attendance_status)}</td>
              <td style={{ padding: '3px 8px' }}>
                {p.purchases.length === 0
                  ? <span style={{ color: 'var(--muted2)' }}>—</span>
                  : p.purchases.map((q, i) => (
                      <div key={i} style={{ whiteSpace: 'nowrap' }}>
                        <span style={{ color: q.is_jsu_course ? 'var(--gold)' : 'var(--text)' }}>{q.amount.toFixed(0)} PLN</span>
                        {q.is_jsu_course && <span style={{ color: 'var(--gold)', fontSize: '0.6rem' }}> JSU</span>}
                        <span style={{ color: 'var(--muted)' }}> · {q.order_created_at ? new Date(q.order_created_at).toLocaleDateString('pl-PL') : '—'} · </span>
                        {q.phase === 'after'
                          ? <span style={{ color: 'var(--emerald)' }}>konwersja</span>
                          : <span style={{ color: 'var(--muted2)', fontStyle: 'italic' }} title="Zamówienie sprzed webinaru — wejście do lejka, nie konwersja">pre-webinar</span>}
                        <span style={{ color: 'var(--muted2)' }} title={q.product_name_raw ?? ''}> · {(q.product_name_raw ?? '').slice(0, 26)}</span>
                      </div>
                    ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function detectProduct(sessions: JsuFunnelRow[]): ProductTag {
  const counts: Record<ProductTag, number> = { JSU: 0, JZK: 0, UNKNOWN: 0 }
  for (const s of sessions) counts[tagOf(s)]++
  if (counts.JZK > counts.JSU) return 'JZK'
  if (counts.JSU > 0) return 'JSU'
  return 'UNKNOWN'
}

export function WebinarFunnelPanel({ summary, participants, participantsLoading, loading, onCommand, gieniuResponse }: Props) {
  const [showParticipants, setShowParticipants] = useState(false)
  const [productFilter, setProductFilter] = useState<ProductTag | 'ALL'>('ALL')
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)

  if (loading) {
    return (
      <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', padding: '20px 0' }}>
        Loading webinar funnel data...
      </div>
    )
  }

  const noData = !summary || summary.bottleneck === 'NO_DATA' || summary.bottleneck === 'NO_SOURCES'
  const bn = summary?.bottleneck ?? 'NO_DATA'
  const bnColor = BOTTLENECK_COLOR[bn]

  const debug = summary?._debug
  const attendancePopulated = debug?.attendanceStatus === 'populated' || (summary?.totals.attendees ?? 0) > 0
  const purchasesMapped     = debug?.purchaseMappingStatus === 'mapped' || (summary?.totals.purchases ?? 0) > 0

  // Filtered sessions for table view — product_tag is the single source of truth
  const filteredSessions = summary?.sessions.filter(s => {
    if (productFilter === 'ALL') return true
    return tagOf(s) === productFilter
  }) ?? []

  // Detect dominant product from all sessions (by product_tag)
  const dominantProduct = summary?.sessions.length ? detectProduct(summary.sessions) : 'JSU'
  const productLabel = dominantProduct === 'JZK' ? 'Językozak AI' : 'Jak się uczyć'
  const productSubtitle = dominantProduct === 'JZK' ? 'Language webinar · Tuesday 18:00' : 'Memory webinar · Thursday 18:00'

  // Count products for tab badges — from product_tag (JSU / JZK / UNKNOWN)
  const jsuCount     = summary?.sessions.filter(s => tagOf(s) === 'JSU').length ?? 0
  const jzkCount     = summary?.sessions.filter(s => tagOf(s) === 'JZK').length ?? 0
  const unknownCount = summary?.sessions.filter(s => tagOf(s) === 'UNKNOWN').length ?? 0

  // This-week sessions split by schedule
  const thisWeekSessions = (() => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
    const [y, m, d] = today.split('-').map(Number)
    const dow = new Date(y, m - 1, d).getDay()
    const daysToMon = dow === 0 ? 6 : dow - 1
    const weekStart = new Date(y, m - 1, d - daysToMon).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
    return summary?.sessions.filter(s => {
      if (!s.scheduled_at) return false
      const sd = new Date(s.scheduled_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
      return sd >= weekStart && sd <= today
    }) ?? []
  })()
  const thisWeekJsu = thisWeekSessions.filter(s => tagOf(s) === 'JSU')
  const thisWeekJzk = thisWeekSessions.filter(s => tagOf(s) === 'JZK')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.05em' }}>
            WEBINARS — funnel
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
            {summary?.sessions.length ? `${summary.sessions.length} sessions · dominant: ${productLabel}` : productSubtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.72rem',
            letterSpacing: '0.08em', color: bnColor,
            border: `1px solid ${bnColor}`, padding: '3px 10px', borderRadius: '16px',
          }}>
            {BOTTLENECK_LABEL[bn]}
          </span>
        </div>
      </div>

      {/* Funnel steps */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <FunnelStep label="Sent"       value={summary?.totals.email_sent.toLocaleString('en-US') ?? 0} missing={!summary?.hasEmailData} />
        <FunnelStep label="Delivered"  value={summary?.totals.email_delivered.toLocaleString('en-US') ?? 0} rate={summary?.rates.delivery_rate} rateLabel="del." missing={!summary?.hasEmailData} />
        <FunnelStep label="Opens"      value={summary?.totals.email_opens.toLocaleString('en-US') ?? 0} rate={summary?.rates.open_rate} rateLabel="OR" missing={!summary?.hasEmailData} />
        <FunnelStep label="Clicks"     value={summary?.totals.email_clicks.toLocaleString('en-US') ?? 0} rate={summary?.rates.click_rate} rateLabel="CTR" missing={!summary?.hasEmailData} />
        <FunnelStep label="Reg."       value={summary?.totals.registered ?? 0} missing={!summary?.hasClickMeetingData} />
        <FunnelStep label="Live"       value={summary?.totals.attendees ?? 0} rate={summary?.rates.attendance_rate} rateLabel="show-up"
          missing={!summary?.hasClickMeetingData}
          notPopulated={summary?.hasClickMeetingData && !attendancePopulated} />
        <FunnelStep label="Sales 7d"   value={summary?.totals.purchases ?? 0} rate={summary?.rates.purchase_rate} rateLabel="conv."
          missing={!summary?.hasClickMeetingData}
          notMapped={summary?.hasClickMeetingData && !purchasesMapped} />
        <FunnelStep label="Revenue 7d" value={fmtPlnFunnel(summary?.totals.revenue)}
          missing={!summary?.hasClickMeetingData}
          notMapped={summary?.hasClickMeetingData && !purchasesMapped} />
      </div>

      {/* This-week JSU / JZK cards — separate by fixed schedule */}
      {thisWeekSessions.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
          {/* JSU card (Thursday 18:00) */}
          <div style={{ background: 'var(--surface)', border: `1px solid ${thisWeekJsu.length > 0 ? 'var(--border-gold)' : 'var(--border)'}`, borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: thisWeekJsu.length > 0 ? 'var(--gold)' : 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
              JSU / Memory — Thu 18:00
            </div>
            {thisWeekJsu.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>No session this week</div>
            ) : thisWeekJsu.map(s => {
              const sp = summary!.sessions.find(r => r.session_id === s.session_id)!
              const dateStr = s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }) : s.session_date
              return (
                <div key={s.session_id} style={{ fontSize: '0.73rem', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                  <div style={{ color: 'var(--text2)' }}>{dateStr} · {s.session_name?.slice(0, 30)}</div>
                  <div style={{ color: sp?.registered_count > 0 ? 'var(--text)' : 'var(--muted2)' }}>
                    Registrations: {sp?.registered_count > 0 ? sp.registered_count : <span style={{ color: 'var(--muted2)' }}>—</span>}
                  </div>
                  <div style={{ color: 'var(--muted)' }}>
                    Attendance: {attendancePopulated && sp?.attendee_count > 0 ? sp.attendee_count : <span style={{ fontStyle: 'italic' }}>not populated</span>}
                  </div>
                  <div style={{ color: (sp?.purchases ?? 0) > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>
                    Sales: {sp?.purchases ?? 0}{(sp?.revenue ?? 0) > 0 ? ` · ${sp!.revenue.toFixed(0)} PLN` : ''}
                    {(sp?.jsu_course_sales ?? 0) > 0 && (
                      <span style={{ color: 'var(--gold)' }} title="JSU course sold after the webinar (549 PLN)"> · JSU {sp!.jsu_course_sales} ({sp!.jsu_course_revenue!.toFixed(0)} PLN)</span>
                    )}
                  </div>
                  {(sp?.pre_webinar_count ?? 0) > 0 && (
                    <div style={{ color: 'var(--muted2)', fontStyle: 'italic', fontSize: '0.66rem' }} title="Pre-webinar customers: ordered BEFORE the webinar — funnel entries, not conversions">
                      Pre-webinar customers: {sp!.pre_webinar_count} · {sp!.pre_webinar_revenue!.toFixed(0)} PLN (not counted as sales)
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* JZK card (Tuesday 18:00) */}
          <div style={{ background: 'var(--surface)', border: `1px solid ${thisWeekJzk.length > 0 ? 'var(--teal)' : 'var(--border)'}`, borderRadius: '8px', padding: '14px 16px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: thisWeekJzk.length > 0 ? 'var(--teal)' : 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
              JZK / Językozak AI — Tue 18:00
            </div>
            {thisWeekJzk.length === 0 ? (
              <div style={{ fontSize: '0.72rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>No session this week</div>
            ) : thisWeekJzk.map(s => {
              const sp = summary!.sessions.find(r => r.session_id === s.session_id)!
              const dateStr = s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }) : s.session_date
              return (
                <div key={s.session_id} style={{ fontSize: '0.73rem', fontFamily: 'var(--font-mono)', lineHeight: 1.7 }}>
                  <div style={{ color: 'var(--text2)' }}>{dateStr} · {s.session_name?.slice(0, 30)}</div>
                  <div style={{ color: sp?.registered_count > 0 ? 'var(--text)' : 'var(--muted2)' }}>
                    Registrations: {sp?.registered_count > 0 ? sp.registered_count : <span style={{ color: 'var(--muted2)' }}>—</span>}
                  </div>
                  <div style={{ color: 'var(--muted)' }}>
                    Attendance: {attendancePopulated && sp?.attendee_count > 0 ? sp.attendee_count : <span style={{ fontStyle: 'italic' }}>not populated</span>}
                  </div>
                  <div style={{ color: (sp?.purchases ?? 0) > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>
                    Sales: {sp?.purchases ?? 0}{(sp?.revenue ?? 0) > 0 ? ` · ${sp!.revenue.toFixed(0)} PLN` : ''}
                    {(sp?.jsu_course_sales ?? 0) > 0 && (
                      <span style={{ color: 'var(--gold)' }} title="JSU course sold after the webinar (549 PLN)"> · JSU {sp!.jsu_course_sales} ({sp!.jsu_course_revenue!.toFixed(0)} PLN)</span>
                    )}
                  </div>
                  {(sp?.pre_webinar_count ?? 0) > 0 && (
                    <div style={{ color: 'var(--muted2)', fontStyle: 'italic', fontSize: '0.66rem' }} title="Pre-webinar customers: ordered BEFORE the webinar — funnel entries, not conversions">
                      Pre-webinar customers: {sp!.pre_webinar_count} · {sp!.pre_webinar_revenue!.toFixed(0)} PLN (not counted as sales)
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Product filter tabs — from product_tag (UNKNOWN is its own category) */}
      {(jsuCount > 0 || jzkCount > 0 || unknownCount > 0) && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {(['ALL', 'JSU', 'JZK', 'UNKNOWN'] as const).map(tag => {
            const count = tag === 'ALL' ? (summary?.sessions.length ?? 0)
              : tag === 'JSU' ? jsuCount
              : tag === 'JZK' ? jzkCount
              : unknownCount
            if (tag !== 'ALL' && count === 0) return null
            const isActive = productFilter === tag
            const label = tag === 'ALL' ? 'All'
              : tag === 'JSU' ? 'JSU / Memory'
              : tag === 'JZK' ? 'JZK / Językozak'
              : 'UNKNOWN'
            return (
              <button
                key={tag}
                onClick={() => setProductFilter(tag)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.7rem', letterSpacing: '0.06em',
                  padding: '4px 12px', borderRadius: '14px', cursor: 'pointer',
                  border: `1px solid ${isActive ? 'var(--border-gold)' : 'var(--border)'}`,
                  background: isActive ? 'rgba(238,157,0,0.10)' : 'var(--surface2)',
                  color: isActive ? 'var(--gold)' : 'var(--muted)',
                }}
              >
                {label}
                {count > 0 && <span style={{ marginLeft: '6px', opacity: 0.6 }}>{count}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Data source debug bar — always visible */}
      <DataDebugBar debug={debug} />

      {/* Missing data notices */}
      {!summary?.hasEmailData && (
        <div style={{
          background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: '8px',
          padding: '12px 16px', fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.6,
        }}>
          No email data yet — deliverability, open rate, and click rate cannot be assessed.
          <br />
          Connect Make → ESP → Supabase (email_campaigns, email_recipient_events).
        </div>
      )}
      {!summary?.hasClickMeetingData && (
        <ClickMeetingStatus debug={debug} />
      )}

      {/* Diagnosis box */}
      {summary && !noData && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderLeft: `3px solid ${bnColor}`, borderRadius: '8px', padding: '14px 16px',
        }}>
          <div style={{ fontSize: '0.65rem', color: bnColor, fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            Stanley's Diagnosis
          </div>
          <div style={{ fontSize: '0.86rem', color: 'var(--text)', lineHeight: 1.65, fontFamily: 'var(--font-mono)' }}>
            {summary.diagnosis}
          </div>
        </div>
      )}

      {/* GIENIU response (from commands) */}
      {gieniuResponse && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '16px' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--gold)', fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
            STANLEY
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.86rem', color: 'var(--text)', lineHeight: 1.7 }}>
            {gieniuResponse}
          </pre>
        </div>
      )}

      {/* Command buttons */}
      <div>
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
          JSU Commands
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {JSU_COMMANDS.map(cmd => (
            <button key={cmd.key} className="btn-cmd" onClick={() => onCommand(cmd.key)}>
              {cmd.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per-session table */}
      {summary && filteredSessions.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
            Webinar History {productFilter !== 'ALL' ? `· ${productFilter}` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'var(--font-mono)', minWidth: '640px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Date</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Product</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Reg.</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Live</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Show-up</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Sales</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map(s => {
                  const expanded = expandedSessionId === s.session_id
                  return (
                    <Fragment key={s.session_id}>
                      <SessionRow
                        s={s}
                        attendancePopulated={attendancePopulated}
                        expanded={expanded}
                        onToggle={() => setExpandedSessionId(prev => prev === s.session_id ? null : s.session_id)}
                      />
                      {expanded && (
                        <tr style={{ background: 'var(--surface2)' }}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <SessionParticipants rows={participants.filter(p => p.session_id === s.session_id)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.62rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>
            Kliknij wiersz sesji, aby rozwinąć listę uczestników. n/p = attendance not populated · „brak danych" = brak wiersza w webinar_attendance (nie „nieobecny").
          </div>
        </div>
      )}

      {/* Participant journey toggle */}
      {summary && summary.hasClickMeetingData && (
        <div>
          <button className="btn-sm" onClick={() => setShowParticipants(prev => !prev)}>
            {showParticipants ? 'Hide participants' : `Show participants (${debug?.participantsCount ?? '?'})`}
          </button>
          {showParticipants && (
            <div style={{ marginTop: '12px' }}>
              <ParticipantJourneyTable
                rows={participants}
                loading={participantsLoading}
                attendancePopulated={attendancePopulated}
              />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {noData && (
        <div style={{
          background: 'var(--surface2)', border: '1px dashed var(--border)',
          borderRadius: '10px', padding: '24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.8 }}>
            No JSU funnel data.
            <br /><br />
            Step 1: Run <code style={{ color: 'var(--text2)' }}>supabase/webinar_funnel_schema.sql</code> in Supabase SQL Editor.
            <br />
            Step 2: Connect Make → ClickMeeting → webinar_sessions + webinar_participants.
            <br />
            Step 3: Connect Make → ESP → email_campaigns + email_recipient_events.
            <br /><br />
            Guide: <code style={{ color: 'var(--text2)' }}>docs/clickmeeting_make_scenarios.md</code>
          </div>
        </div>
      )}
    </div>
  )
}

const thStyle: CSSProperties = {
  padding: '4px 8px',
  fontWeight: 'normal',
  whiteSpace: 'nowrap',
}
