import { useState, type CSSProperties } from 'react'
import type { JsuFunnelSummary, JsuFunnelRow, JsuParticipantRow, FunnelBottleneck } from '../services/webinarFunnel'
import { pct, fmtZlFunnel } from '../services/webinarFunnel'
import { ParticipantJourneyTable } from './ParticipantJourneyTable'
import type { JsuCommandKey } from '../brain/responses'

interface Props {
  summary: JsuFunnelSummary | null
  participants: JsuParticipantRow[]
  participantsLoading: boolean
  loading: boolean
  onCommand: (key: JsuCommandKey) => void
  gieniuResponse: string
}

const BOTTLENECK_COLOR: Record<FunnelBottleneck, string> = {
  NO_DATA:         '#555',
  NO_SOURCES:      '#888',
  DELIVERABILITY:  '#ff6b00',
  OPENS:           '#ff6b00',
  CLICKS:          '#ff6b00',
  REGISTRATIONS:   '#ff6b00',
  ATTENDANCE:      '#e8ff00',
  PURCHASE_PITCH:  '#ff6b00',
  PRODUCT_MAPPING: '#ff3333',
  OK:              '#00ff88',
}

const BOTTLENECK_LABEL: Record<FunnelBottleneck, string> = {
  NO_DATA:         'BRAK DANYCH',
  NO_SOURCES:      'BRAK ŹRÓDEŁ',
  DELIVERABILITY:  'DOSTARCZALNOŚĆ',
  OPENS:           'OPEN RATE',
  CLICKS:          'CLICK RATE',
  REGISTRATIONS:   'REJESTRACJE',
  ATTENDANCE:      'FREKWENCJA',
  PURCHASE_PITCH:  'PITCH / OFERTA',
  PRODUCT_MAPPING: 'MAPOWANIE PRODUKTU',
  OK:              'OK',
}

const JSU_COMMANDS: { key: JsuCommandKey; label: string }[] = [
  { key: 'webinar jak się uczyć',      label: 'JSU — raport' },
  { key: 'czemu kurs się nie sprzedaje', label: 'Czemu nie sprzedaje?' },
  { key: 'funnel JSU',                 label: 'Funnel JSU' },
  { key: 'porównaj webinary JSU',      label: 'Porównaj webinary' },
  { key: 'deliverability',             label: 'Deliverability' },
  { key: 'czy mailing siadł',          label: 'Mailing siadł?' },
  { key: 'attendance rate',            label: 'Attendance rate' },
  { key: 'kto był i kupił',            label: 'Kto był i kupił' },
]

function FunnelStep({
  label,
  value,
  rate,
  rateLabel,
  missing,
}: {
  label: string
  value: number | string
  rate?: number | null
  rateLabel?: string
  missing?: boolean
}) {
  return (
    <div
      style={{
        flex: '1 1 100px',
        background: '#0d0d0d',
        border: `1px solid ${missing ? '#2a2a2a' : '#333'}`,
        borderRadius: '8px',
        padding: '10px 12px',
        minWidth: '90px',
      }}
    >
      <div style={{ fontSize: '0.62rem', color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700, color: missing ? '#333' : '#e0e0e0', fontVariantNumeric: 'tabular-nums' }}>
        {missing ? '—' : value}
      </div>
      {rate !== undefined && (
        <div style={{ fontSize: '0.68rem', color: missing ? '#333' : '#888', marginTop: '3px', fontFamily: 'monospace' }}>
          {missing ? '—' : (rate != null ? pct(rate) : '—')} {rateLabel ?? ''}
        </div>
      )}
    </div>
  )
}

function SessionRow({ s }: { s: JsuFunnelRow }) {
  const bottleneckColor = (() => {
    if (s.attendance_rate_pct !== null && s.attendance_rate_pct < 60) return '#ff6b00'
    if (s.purchase_rate_pct !== null && s.purchase_rate_pct < 3) return '#e8ff00'
    if (s.purchases > 0) return '#00ff88'
    return '#555'
  })()

  return (
    <tr style={{ borderBottom: '1px solid #1a1a1a', fontSize: '0.73rem', fontFamily: 'monospace' }}>
      <td style={{ padding: '5px 8px', color: '#ccc', whiteSpace: 'nowrap' }}>
        {new Date(s.scheduled_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
      </td>
      <td style={{ padding: '5px 8px', color: '#888', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {s.email_delivered > 0 ? s.email_delivered.toLocaleString('pl-PL') : '—'}
      </td>
      <td style={{ padding: '5px 8px', color: '#888', textAlign: 'right' }}>
        {s.email_opens > 0 ? pct(s.email_opens / (s.email_delivered || 1)) : '—'}
      </td>
      <td style={{ padding: '5px 8px', color: '#888', textAlign: 'right' }}>
        {s.email_clicks > 0 ? pct(s.email_clicks / (s.email_delivered || 1)) : '—'}
      </td>
      <td style={{ padding: '5px 8px', color: '#ccc', textAlign: 'right' }}>
        {s.registered_count > 0 ? s.registered_count : '—'}
      </td>
      <td style={{ padding: '5px 8px', color: '#ccc', textAlign: 'right' }}>
        {s.attendee_count > 0 ? s.attendee_count : '—'}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: s.attendance_rate_pct !== null && s.attendance_rate_pct < 60 ? '#ff6b00' : '#888' }}>
        {s.attendance_rate_pct != null ? s.attendance_rate_pct + '%' : '—'}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: bottleneckColor, fontWeight: s.purchases > 0 ? 700 : 400 }}>
        {s.purchases}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: s.revenue > 0 ? '#00ff88' : '#555' }}>
        {s.revenue > 0 ? s.revenue.toFixed(0) + ' zł' : '—'}
      </td>
    </tr>
  )
}

export function WebinarFunnelPanel({ summary, participants, participantsLoading, loading, onCommand, gieniuResponse }: Props) {
  const [showParticipants, setShowParticipants] = useState(false)

  if (loading) {
    return (
      <div style={{ color: '#444', fontFamily: 'monospace', fontSize: '0.85rem', padding: '20px 0' }}>
        Ładuję dane webinar funnel...
      </div>
    )
  }

  const noData = !summary || summary.bottleneck === 'NO_DATA' || summary.bottleneck === 'NO_SOURCES'
  const bn = summary?.bottleneck ?? 'NO_DATA'
  const bnColor = BOTTLENECK_COLOR[bn]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: '#e0e0e0', letterSpacing: '0.05em' }}>
            JAK SIĘ UCZYĆ — webinar funnel
          </div>
          <div style={{ fontSize: '0.68rem', color: '#555', fontFamily: 'monospace', marginTop: '4px' }}>
            kurs 549 zł · czwartek 18:00 · ścieżka pamięć
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '0.72rem',
              letterSpacing: '0.08em',
              color: bnColor,
              border: `1px solid ${bnColor}`,
              padding: '3px 10px',
              borderRadius: '16px',
            }}
          >
            {BOTTLENECK_LABEL[bn]}
          </span>
        </div>
      </div>

      {/* Funnel steps */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <FunnelStep label="Wysłano" value={summary?.totals.email_sent.toLocaleString('pl-PL') ?? 0} missing={!summary?.hasEmailData} />
        <FunnelStep label="Dostarczono" value={summary?.totals.email_delivered.toLocaleString('pl-PL') ?? 0} rate={summary?.rates.delivery_rate} rateLabel="del." missing={!summary?.hasEmailData} />
        <FunnelStep label="Otwarcia" value={summary?.totals.email_opens.toLocaleString('pl-PL') ?? 0} rate={summary?.rates.open_rate} rateLabel="OR" missing={!summary?.hasEmailData} />
        <FunnelStep label="Kliknięcia" value={summary?.totals.email_clicks.toLocaleString('pl-PL') ?? 0} rate={summary?.rates.click_rate} rateLabel="CTR" missing={!summary?.hasEmailData} />
        <FunnelStep label="Zapisy" value={summary?.totals.registered.toLocaleString('pl-PL') ?? 0} missing={!summary?.hasClickMeetingData} />
        <FunnelStep label="Obecni" value={summary?.totals.attendees.toLocaleString('pl-PL') ?? 0} rate={summary?.rates.attendance_rate} rateLabel="frekw." missing={!summary?.hasClickMeetingData} />
        <FunnelStep label="Zakupy 7d" value={summary?.totals.purchases ?? 0} rate={summary?.rates.purchase_rate} rateLabel="konw." missing={!summary?.hasClickMeetingData} />
        <FunnelStep label="Przychód 7d" value={fmtZlFunnel(summary?.totals.revenue)} missing={!summary?.hasClickMeetingData} />
      </div>

      {/* Missing data notices */}
      {!summary?.hasEmailData && (
        <div
          style={{
            background: '#0a0a0a',
            border: '1px dashed #333',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '0.78rem',
            color: '#888',
            fontFamily: 'monospace',
            lineHeight: 1.6,
          }}
        >
          Nie mam jeszcze danych z mailingu, więc nie rozstrzygam deliverability, open rate ani click rate.
          <br />
          Podłącz Make → ESP → Supabase (email_campaigns, email_recipient_events).
        </div>
      )}
      {!summary?.hasClickMeetingData && (
        <div
          style={{
            background: '#0a0a0a',
            border: '1px dashed #333',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '0.78rem',
            color: '#888',
            fontFamily: 'monospace',
            lineHeight: 1.6,
          }}
        >
          Nie mam jeszcze danych z ClickMeeting, więc nie rozstrzygam zapisów i obecności.
          <br />
          Podłącz Make → ClickMeeting API → Supabase (webinar_sessions, webinar_participants).
        </div>
      )}

      {/* Diagnosis box */}
      {summary && !noData && (
        <div
          style={{
            background: '#0d0d0d',
            border: `1px solid ${bnColor}33`,
            borderLeft: `3px solid ${bnColor}`,
            borderRadius: '8px',
            padding: '14px 16px',
          }}
        >
          <div style={{ fontSize: '0.65rem', color: bnColor, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            Diagnoza Gienia
          </div>
          <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.65, fontFamily: 'monospace' }}>
            {summary.diagnosis}
          </div>
        </div>
      )}

      {/* GIENIU response (from commands) */}
      {gieniuResponse && (
        <div
          style={{
            background: '#111',
            border: '1px solid #2a2a2a',
            borderRadius: '10px',
            padding: '16px',
          }}
        >
          <div style={{ fontSize: '0.65rem', color: '#e8ff00', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
            GIENIU
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.82rem', color: '#e0e0e0', lineHeight: 1.7 }}>
            {gieniuResponse}
          </pre>
        </div>
      )}

      {/* Command buttons */}
      <div>
        <div style={{ fontSize: '0.65rem', color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
          Komendy JSU
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {JSU_COMMANDS.map(cmd => (
            <button
              key={cmd.key}
              className="btn-cmd"
              onClick={() => onCommand(cmd.key)}
            >
              {cmd.label}
            </button>
          ))}
        </div>
      </div>

      {/* Per-session table */}
      {summary && summary.sessions.length > 0 && (
        <div>
          <div style={{ fontSize: '0.65rem', color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
            Historia webinarów JSU
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'monospace', minWidth: '600px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#555' }}>
                  <th style={{ ...thStyle, textAlign: 'left' }}>Data</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Dost.</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>OR</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>CTR</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Zapisy</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Obecni</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Frekw.</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Zakupy</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Przychód</th>
                </tr>
              </thead>
              <tbody>
                {summary.sessions.map(s => (
                  <SessionRow key={s.session_id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Participant journey toggle */}
      {summary && summary.hasClickMeetingData && (
        <div>
          <button
            className="btn-sm"
            onClick={() => setShowParticipants(prev => !prev)}
          >
            {showParticipants ? 'Ukryj uczestników' : 'Pokaż uczestników (kto był i kupił)'}
          </button>
          {showParticipants && (
            <div style={{ marginTop: '12px' }}>
              <ParticipantJourneyTable rows={participants} loading={participantsLoading} />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {noData && (
        <div
          style={{
            background: '#0a0a0a',
            border: '1px dashed #2a2a2a',
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '0.78rem', color: '#555', fontFamily: 'monospace', lineHeight: 1.8 }}>
            Brak danych funnel JSU.
            <br /><br />
            Krok 1: Uruchom <code style={{ color: '#888' }}>supabase/webinar_funnel_schema.sql</code> w Supabase SQL Editor.
            <br />
            Krok 2: Podłącz Make → ClickMeeting → webinar_sessions + webinar_participants.
            <br />
            Krok 3: Podłącz Make → ESP → email_campaigns + email_recipient_events.
            <br /><br />
            Instrukcja: <code style={{ color: '#888' }}>docs/clickmeeting_make_scenarios.md</code>
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
