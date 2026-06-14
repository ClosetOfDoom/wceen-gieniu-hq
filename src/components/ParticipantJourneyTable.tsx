import type { CSSProperties } from 'react'
import type { JsuParticipantRow } from '../services/webinarFunnel'

interface Props {
  rows: JsuParticipantRow[]
  loading: boolean
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return local.slice(0, 2) + '***@' + domain
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
}

export function ParticipantJourneyTable({ rows, loading }: Props) {
  if (loading) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.78rem', padding: '12px 0' }}>
        Ładuję uczestników...
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div
        style={{
          color: '#555',
          fontFamily: 'monospace',
          fontSize: '0.78rem',
          padding: '16px 0',
          lineHeight: 1.6,
        }}
      >
        Brak danych uczestników JSU.
        <br />
        Uruchom Make → ClickMeeting → Supabase (webinar_participants).
      </div>
    )
  }

  const buyers = rows.filter(r => r.purchased_at !== null)
  const attendedNoBuy = rows.filter(r => r.attended && r.purchased_at === null)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '12px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: '0.72rem', color: '#00ff88', fontFamily: 'monospace' }}>
          Kupili: {buyers.length}
        </span>
        <span style={{ fontSize: '0.72rem', color: '#e8ff00', fontFamily: 'monospace' }}>
          Byli, nie kupili: {attendedNoBuy.length}
        </span>
        <span style={{ fontSize: '0.72rem', color: '#555', fontFamily: 'monospace' }}>
          Łącznie uczestników: {rows.filter(r => r.attended).length} / {rows.length} zapisanych
        </span>
      </div>
      <div style={{ overflowX: 'auto', maxHeight: '280px', overflowY: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.73rem',
            fontFamily: 'monospace',
          }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#555', position: 'sticky', top: 0, background: '#111' }}>
              <th style={th}>Email</th>
              <th style={th}>Webinar</th>
              <th style={{ ...th, textAlign: 'center' }}>Był</th>
              <th style={{ ...th, textAlign: 'right' }}>Min</th>
              <th style={{ ...th, textAlign: 'center' }}>Kupił</th>
              <th style={{ ...th, textAlign: 'right' }}>Wartość</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.participant_id}
                style={{
                  borderBottom: '1px solid #1a1a1a',
                  color: row.purchased_at ? '#00ff88' : row.attended ? '#ccc' : '#555',
                }}
              >
                <td style={td}>{maskEmail(row.email)}</td>
                <td style={td}>{fmtDate(row.session_date)}</td>
                <td style={{ ...td, textAlign: 'center' }}>{row.attended ? '✓' : '–'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{row.attend_duration_min ?? '—'}</td>
                <td style={{ ...td, textAlign: 'center' }}>{row.purchased_at ? '✓' : '–'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {row.purchase_value != null ? row.purchase_value.toFixed(0) + ' zł' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const th: CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  fontWeight: 'normal',
  whiteSpace: 'nowrap',
}
const td: CSSProperties = {
  padding: '5px 8px',
  maxWidth: '160px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
