// Webinar history — read straight from v_webinar_funnel.
//
// The view keys attendance on clickmeeting_room_id + clickmeeting_session_id.
// Nothing here joins on webinar_id: that column is NULL on every attendance row
// since the FK to webinars was dropped, which is exactly why the panel used to
// show nothing while the table held 2292 rows across 52 sessions.

import { Fragment, useEffect, useState } from 'react'
import {
  fetchSessionAttendees, showUpRate,
  type FunnelViewRow, type AttendeeRow,
} from '../services/webinarFunnelView'

const thStyle: React.CSSProperties = {
  padding: '5px 8px', fontWeight: 600, fontSize: '0.62rem',
  textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
}

const NoData = ({ title }: { title: string }) => (
  <span style={{ color: 'var(--muted2)', fontStyle: 'italic', fontSize: '0.66rem' }} title={title}>
    brak danych
  </span>
)

const productColor = (tag: string | null) =>
  tag === 'JZK' ? 'var(--teal)' : tag === 'JSU' ? 'var(--gold)' : 'var(--muted2)'

export function WebinarHistoryTable({ rows }: { rows: FunnelViewRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
        v_webinar_funnel nie zwrócił żadnych sesji.
      </div>
    )
  }

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'var(--font-mono)', minWidth: '680px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}>
              <th style={{ ...thStyle, textAlign: 'left' }}>Data</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Produkt</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Zapisani</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Obecni</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Śr. min</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Show-up</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Sprzedaż</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Przychód</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const key = `${s.clickmeeting_room_id}|${s.clickmeeting_session_id}`
              const isOpen = expanded === key
              // No attendance rows for the session → unknown, never a measured zero.
              const hasAttendance = s.attendees != null && s.attendees > 0
              const su = showUpRate(s.registered, s.attendees)

              return (
                <Fragment key={key}>
                  <tr
                    onClick={() => setExpanded(cur => (cur === key ? null : key))}
                    style={{
                      borderBottom: '1px solid var(--border)', cursor: 'pointer',
                      background: isOpen ? 'var(--surface2)' : undefined,
                    }}
                    title="Kliknij, aby rozwinąć listę obecnych"
                  >
                    <td style={{ padding: '5px 8px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      <span aria-hidden="true" style={{ color: isOpen ? 'var(--gold)' : 'var(--muted2)', marginRight: 5 }}>{isOpen ? '▾' : '▸'}</span>
                      {s.session_started_at
                        ? new Date(s.session_started_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : '—'}
                    </td>
                    <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.65rem', color: productColor(s.product_tag), border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>
                        {s.product_tag ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text2)' }}>
                      {s.registered != null && s.registered > 0
                        ? s.registered
                        : <NoData title="Brak danych rejestracyjnych dla tej sesji" />}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text)', fontWeight: hasAttendance ? 700 : 400 }}>
                      {hasAttendance
                        ? s.attendees
                        : <NoData title="Brak wierszy w webinar_attendance dla tej sesji — to nie to samo co zero obecnych" />}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--teal)' }}>
                      {s.avg_minutes != null && hasAttendance
                        ? s.avg_minutes
                        : <NoData title="Brak czasu w pokoju dla tej sesji" />}
                    </td>
                    {/* Show-up is never computed from an untrustworthy denominator:
                        in most sessions attendees > registered, so a percentage
                        would read above 100 and mean nothing. */}
                    <td style={{ padding: '5px 8px', textAlign: 'right' }}>
                      {su.kind === 'pct' ? (
                        <span style={{ color: su.value < 60 ? 'var(--orange)' : 'var(--muted)' }}>{su.value}%</span>
                      ) : su.kind === 'unreliable' ? (
                        <span style={{ color: 'var(--amber)', cursor: 'help' }} title={su.reason}>?</span>
                      ) : (
                        <span style={{ color: 'var(--muted2)' }} title="Brak danych rejestracyjnych">—</span>
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: (s.buyers ?? 0) > 0 ? 'var(--emerald)' : 'var(--muted2)', fontWeight: (s.buyers ?? 0) > 0 ? 700 : 400 }}>
                      {s.buyers ?? 0}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'right', color: (s.revenue_7d ?? 0) > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>
                      {(s.revenue_7d ?? 0) > 0 ? Math.round(s.revenue_7d!) + ' PLN' : '—'}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr style={{ background: 'var(--surface2)' }}>
                      <td colSpan={8} style={{ padding: 0 }}>
                        <AttendeeList room={s.clickmeeting_room_id} session={s.clickmeeting_session_id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 4, fontSize: '0.62rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)' }}>
        Źródło: v_webinar_funnel (klucz: clickmeeting_room_id + clickmeeting_session_id). Show-up „?" = obecnych więcej niż zapisanych, rejestracje niekompletne — procent nie jest liczony.
      </div>
    </div>
  )
}

// ── attendee drill-down ─────────────────────────────────────────────────────
function AttendeeList({ room, session }: { room: string; session: string }) {
  const [state, setState] = useState<{ loading: boolean; hasData: boolean; rows: AttendeeRow[]; error: string | null }>(
    { loading: true, hasData: false, rows: [], error: null },
  )

  useEffect(() => {
    let alive = true
    setState({ loading: true, hasData: false, rows: [], error: null })
    fetchSessionAttendees(room, session).then(r => {
      if (!alive) return
      setState({ loading: false, hasData: r.hasData, rows: r.attendees, error: r.error })
    })
    return () => { alive = false }
  }, [room, session])

  const cell: React.CSSProperties = { padding: '3px 8px', whiteSpace: 'nowrap' }

  if (state.loading) {
    return <div style={{ padding: '10px 12px', fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Ładowanie obecnych…</div>
  }
  if (state.error) {
    return <div style={{ padding: '10px 12px', fontSize: '0.7rem', color: 'var(--orange)', fontFamily: 'var(--font-mono)' }}>Błąd: {state.error}</div>
  }
  if (!state.hasData || state.rows.length === 0) {
    return (
      <div style={{ padding: '10px 12px', fontSize: '0.7rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>
        Brak danych — webinar_attendance nie ma wierszy dla tej sesji (to nie znaczy, że nikogo nie było).
      </div>
    )
  }

  const buyers = state.rows.filter(a => a.bought7d).length

  return (
    <div style={{ padding: '4px 8px 12px', overflowX: 'auto' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--muted)', padding: '4px 8px' }}>
        {state.rows.length} obecnych · {buyers} z zamówieniem w ciągu 7 dni po sesji
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', minWidth: '520px' }}>
        <thead>
          <tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
            <th style={cell}>Uczestnik</th>
            <th style={cell}>E-mail</th>
            <th style={{ ...cell, textAlign: 'right' }}>Czas w pokoju</th>
            <th style={cell}>Zamówienie ≤7 dni</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((a, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--text2)' }}>
              <td style={cell}>{a.login ?? '—'}</td>
              <td style={cell}>{a.email_masked}</td>
              <td style={{ ...cell, textAlign: 'right', color: 'var(--teal)' }}>
                {a.minutes != null ? `${a.minutes} min` : <span style={{ color: 'var(--muted2)' }}>—</span>}
              </td>
              <td style={cell}>
                {a.bought7d
                  ? <span style={{ color: 'var(--emerald)' }}>
                      tak{a.bought_amount > 0 ? ` · ${Math.round(a.bought_amount)} PLN` : ''}
                      {a.bought_at ? ` · ${new Date(a.bought_at).toLocaleDateString('pl-PL')}` : ''}
                    </span>
                  : <span style={{ color: 'var(--muted2)' }}>nie</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
