import type { CSSProperties } from 'react'
import type { JsuParticipantRow } from '../services/webinarFunnel'
import { maskEmail } from '../lib/clickmeetingNormalize'

interface Props {
  rows: JsuParticipantRow[]
  loading: boolean
  attendancePopulated?: boolean  // false = all attended=false rows may just be unpopulated
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
  } catch {
    return d.slice(0, 10)
  }
}

function fmtTime(d: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
  } catch {
    return d.slice(0, 10)
  }
}

export function ParticipantJourneyTable({ rows, loading, attendancePopulated }: Props) {
  if (loading) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.78rem', padding: '12px 0' }}>
        Loading participants...
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.78rem', padding: '16px 0', lineHeight: 1.6 }}>
        No JSU participant data.
        <br />
        Connect Make → ClickMeeting → Supabase (webinar_participants).
      </div>
    )
  }

  const buyers           = rows.filter(r => r.purchased_at !== null)
  const attendedCount    = rows.filter(r => r.attended).length
  // If no rows have attended=true and attendancePopulated is not explicitly true,
  // treat attendance as unpopulated rather than 100% no-show
  const attendanceKnown  = attendancePopulated !== false && attendedCount > 0

  return (
    <div>
      {/* Summary chips */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: '#00ff88', fontFamily: 'monospace' }}>
          Bought: {buyers.length}
        </span>
        {attendanceKnown ? (
          <>
            <span style={{ fontSize: '0.72rem', color: '#e8ff00', fontFamily: 'monospace' }}>
              Attended, no purchase: {rows.filter(r => r.attended && r.purchased_at === null).length}
            </span>
            <span style={{ fontSize: '0.72rem', color: '#555', fontFamily: 'monospace' }}>
              Attendance: {attendedCount} / {rows.length}
            </span>
          </>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#555', fontFamily: 'monospace' }}>
            Registrations: {rows.length} · Attendance: not populated
          </span>
        )}
        {buyers.length === 0 && (
          <span style={{ fontSize: '0.72rem', color: '#555', fontFamily: 'monospace' }}>
            Purchases: not mapped yet
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'monospace' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#555', position: 'sticky', top: 0, background: '#111' }}>
              <th style={th}>Email</th>
              <th style={th}>Webinar</th>
              <th style={th}>Registered</th>
              <th style={{ ...th, textAlign: 'center' }}>Attended</th>
              <th style={{ ...th, textAlign: 'right' }}>Min</th>
              <th style={{ ...th, textAlign: 'center' }}>Bought</th>
              <th style={{ ...th, textAlign: 'right' }}>Value</th>
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
                <td style={td}>{fmtTime(row.session_date)}</td>
                <td style={td}>{fmtDate(row.registered_at)}</td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {attendanceKnown
                    ? (row.attended ? '✓' : '–')
                    : <span style={{ color: '#333' }}>n/a</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {row.attend_duration_min != null ? row.attend_duration_min : <span style={{ color: '#333' }}>—</span>}
                </td>
                <td style={{ ...td, textAlign: 'center' }}>
                  {buyers.length > 0
                    ? (row.purchased_at ? '✓' : '–')
                    : <span style={{ color: '#444', fontSize: '0.65rem' }}>n/m</span>}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {row.purchase_value != null
                    ? row.purchase_value.toFixed(0) + ' PLN'
                    : buyers.length > 0 ? '—' : <span style={{ color: '#444', fontSize: '0.65rem' }}>n/m</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '6px', fontSize: '0.62rem', color: '#333', fontFamily: 'monospace' }}>
        n/a = attendance not populated · n/m = purchases not mapped yet
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
