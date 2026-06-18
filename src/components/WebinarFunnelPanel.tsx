import { useState, type CSSProperties } from 'react'
import type { JsuFunnelSummary, JsuFunnelRow, JsuParticipantRow, FunnelBottleneck, JsuFunnelDebug } from '../services/webinarFunnel'
import { pct, fmtPlnFunnel } from '../services/webinarFunnel'
import { ParticipantJourneyTable } from './ParticipantJourneyTable'
import type { JsuCommandKey } from '../brain/responses'
import { normalizeProduct, type ProductTag } from '../lib/webinarProduct'

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
      background: '#0d0d0d',
      border: `1px solid ${dim ? '#2a2a2a' : '#333'}`,
      borderRadius: '8px',
      padding: '10px 12px',
      minWidth: '90px',
    }}>
      <div style={{ fontSize: '0.62rem', color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: missing ? '1rem' : '1.2rem', fontWeight: 700, color: dim ? '#444' : '#e0e0e0', fontVariantNumeric: 'tabular-nums' }}>
        {missing ? '—' : value}
      </div>
      {statusText && (
        <div style={{ fontSize: '0.62rem', color: '#555', marginTop: '3px', fontFamily: 'monospace', fontStyle: 'italic' }}>
          {statusText}
        </div>
      )}
      {rate !== undefined && !notPopulated && !notMapped && (
        <div style={{ fontSize: '0.68rem', color: missing ? '#333' : '#888', marginTop: '3px', fontFamily: 'monospace' }}>
          {missing ? '—' : (rate != null ? pct(rate) : '—')} {rateLabel ?? ''}
        </div>
      )}
    </div>
  )
}

function ClickMeetingStatus({ debug }: { debug?: JsuFunnelDebug }) {
  if (debug && (debug.sessionsCount > 0 || debug.participantsCount > 0)) {
    return (
      <div style={{ background: '#0a0a0a', border: '1px dashed #555', borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem', color: '#888', fontFamily: 'monospace', lineHeight: 1.7 }}>
        <div style={{ color: '#e8ff00', fontWeight: 700, marginBottom: '4px' }}>ClickMeeting sessions found</div>
        {debug.sessionsCount > 0 && <div>✓ Sessions in DB: <span style={{ color: '#e0e0e0' }}>{debug.sessionsCount}</span></div>}
        {debug.participantsCount > 0 && <div>✓ Participants in DB: <span style={{ color: '#e0e0e0' }}>{debug.participantsCount}</span></div>}
        {debug.sessionsCount > 0 && debug.participantsCount === 0 && <div style={{ color: '#ff6b00' }}>⚠ No participant rows yet — Make may still be syncing</div>}
        <div style={{ marginTop: '4px', color: '#555', fontSize: '0.7rem' }}>Email/ESP data missing — deliverability not assessable.</div>
      </div>
    )
  }
  return (
    <div style={{ background: '#0a0a0a', border: '1px dashed #333', borderRadius: '8px', padding: '12px 16px', fontSize: '0.78rem', color: '#888', fontFamily: 'monospace', lineHeight: 1.6 }}>
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
      background: '#060606',
      border: '1px solid #1a1a1a',
      borderRadius: '4px',
      fontFamily: 'monospace',
      fontSize: '0.64rem',
      color: '#444',
      display: 'flex',
      gap: '16px',
      flexWrap: 'wrap',
    }}>
      <span>data debug:</span>
      <span>source: <span style={{ color: debug.source === 'raw_tables' ? '#00ff88' : '#666' }}>{debug.source}</span></span>
      <span>sessions: <span style={{ color: debug.sessionsCount > 0 ? '#00ff88' : '#555' }}>{debug.sessionsCount}</span></span>
      <span>participants: <span style={{ color: debug.participantsCount > 0 ? '#00ff88' : '#ff6b00' }}>{debug.participantsCount}</span></span>
      {debug.rawParticipants != null && debug.rawParticipants !== debug.participantsCount && (
        <span>raw: <span style={{ color: debug.rawParticipants > 0 ? '#e8ff00' : '#555' }}>{debug.rawParticipants}</span></span>
      )}
      {debug.uniqueEmails != null && <span>unique: <span style={{ color: debug.uniqueEmails > 0 ? '#e0e0e0' : '#555' }}>{debug.uniqueEmails}</span></span>}
      {debug.hasMismatch && <span style={{ color: '#ff6b00' }}>⚠ view mismatch: raw participants available</span>}
      {debug.registrationsFromParticipants && <span style={{ color: '#e8ff00' }}>reg from participants ↑</span>}
      {debug.attendanceStatus === 'not_populated' && <span style={{ color: '#ff6b00' }}>attendance: not populated</span>}
      {debug.purchaseMappingStatus === 'not_mapped_yet' && <span style={{ color: '#555' }}>purchases: not mapped</span>}
      {debug.latestSessionDate && <span>latest: <span style={{ color: '#666' }}>{debug.latestSessionDate}{debug.latestSessionName ? ` / ${debug.latestSessionName.slice(0, 30)}` : ''}</span></span>}
      {debug.lastError && <span style={{ color: '#ff6b00' }}>error: {debug.lastError.slice(0, 60)}</span>}
    </div>
  )
}

function SessionRow({ s, attendancePopulated, purchasesMapped }: {
  s: JsuFunnelRow
  attendancePopulated: boolean
  purchasesMapped: boolean
}) {
  const bottleneckColor = (() => {
    if (attendancePopulated && s.attendance_rate_pct !== null && s.attendance_rate_pct < 60) return '#ff6b00'
    if (purchasesMapped && s.purchase_rate_pct !== null && s.purchase_rate_pct < 3) return '#e8ff00'
    if (s.purchases > 0) return '#00ff88'
    return '#555'
  })()

  const product = normalizeProduct({ product_tag: s.product_tag, session_name: s.session_name })
  const productColor = product.canonicalTag === 'JZK' ? '#2dd4bf' : product.canonicalTag === 'JSU' ? '#c9a96e' : '#555'

  return (
    <tr style={{ borderBottom: '1px solid #1a1a1a', fontSize: '0.73rem', fontFamily: 'monospace' }}>
      <td style={{ padding: '5px 8px', color: '#ccc', whiteSpace: 'nowrap' }}>
        {s.scheduled_at ? new Date(s.scheduled_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : s.session_date}
      </td>
      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: '0.65rem', color: productColor, border: `1px solid ${productColor}44`, borderRadius: '3px', padding: '1px 5px' }}>
          {product.canonicalTag}
        </span>
        {product.reason.includes('overridden') && (
          <span style={{ marginLeft: '4px', fontSize: '0.6rem', color: '#ff6b00' }} title={product.reason}>⚠</span>
        )}
      </td>
      <td style={{ padding: '5px 8px', color: '#ccc', textAlign: 'right' }}>
        {s.registered_count > 0 ? s.registered_count : <span style={{ color: '#444' }}>—</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: attendancePopulated ? '#ccc' : '#444' }}>
        {attendancePopulated
          ? (s.attendee_count > 0 ? s.attendee_count : '0')
          : <span style={{ fontSize: '0.66rem', color: '#444', fontStyle: 'italic' }}>n/p</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: attendancePopulated && s.attendance_rate_pct !== null && s.attendance_rate_pct < 60 ? '#ff6b00' : '#888' }}>
        {attendancePopulated && s.attendance_rate_pct != null
          ? s.attendance_rate_pct + '%'
          : <span style={{ fontSize: '0.66rem', color: '#444', fontStyle: 'italic' }}>n/p</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: bottleneckColor, fontWeight: s.purchases > 0 ? 700 : 400 }}>
        {purchasesMapped ? s.purchases : <span style={{ fontSize: '0.66rem', color: '#444', fontStyle: 'italic' }}>n/m</span>}
      </td>
      <td style={{ padding: '5px 8px', textAlign: 'right', color: s.revenue > 0 ? '#00ff88' : '#555' }}>
        {s.revenue > 0 ? s.revenue.toFixed(0) + ' PLN' : '—'}
      </td>
    </tr>
  )
}

function detectProduct(sessions: JsuFunnelRow[]): ProductTag {
  const counts: Record<ProductTag, number> = { JSU: 0, JZK: 0, OTHER: 0 }
  for (const s of sessions) {
    const p = normalizeProduct({ product_tag: s.product_tag, session_name: s.session_name })
    counts[p.canonicalTag]++
  }
  if (counts.JZK > counts.JSU) return 'JZK'
  if (counts.JSU > 0) return 'JSU'
  return 'OTHER'
}

export function WebinarFunnelPanel({ summary, participants, participantsLoading, loading, onCommand, gieniuResponse }: Props) {
  const [showParticipants, setShowParticipants] = useState(false)
  const [productFilter, setProductFilter] = useState<ProductTag | 'ALL'>('ALL')

  if (loading) {
    return (
      <div style={{ color: '#444', fontFamily: 'monospace', fontSize: '0.85rem', padding: '20px 0' }}>
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

  // Filtered sessions for table view
  const filteredSessions = summary?.sessions.filter(s => {
    if (productFilter === 'ALL') return true
    const p = normalizeProduct({ product_tag: s.product_tag, session_name: s.session_name })
    return p.canonicalTag === productFilter
  }) ?? []

  // Detect dominant product from all sessions
  const dominantProduct = summary?.sessions.length ? detectProduct(summary.sessions) : 'JSU'
  const productLabel = dominantProduct === 'JZK' ? 'Językozak AI' : 'Jak się uczyć'
  const productSubtitle = dominantProduct === 'JZK' ? 'Language webinar · Tuesday 18:00' : 'Memory webinar · Thursday 18:00'

  // Count products for tab badges
  const jsuCount = summary?.sessions.filter(s => normalizeProduct({ product_tag: s.product_tag, session_name: s.session_name }).canonicalTag === 'JSU').length ?? 0
  const jzkCount = summary?.sessions.filter(s => normalizeProduct({ product_tag: s.product_tag, session_name: s.session_name }).canonicalTag === 'JZK').length ?? 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', color: '#e0e0e0', letterSpacing: '0.05em' }}>
            WEBINARS — funnel
          </div>
          <div style={{ fontSize: '0.68rem', color: '#555', fontFamily: 'monospace', marginTop: '4px' }}>
            {summary?.sessions.length ? `${summary.sessions.length} sessions · dominant: ${productLabel}` : productSubtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{
            fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem',
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

      {/* Product filter tabs */}
      {(jsuCount > 0 || jzkCount > 0) && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {(['ALL', 'JSU', 'JZK'] as const).map(tag => {
            const count = tag === 'ALL' ? (summary?.sessions.length ?? 0) : tag === 'JSU' ? jsuCount : jzkCount
            if (tag !== 'ALL' && count === 0) return null
            const isActive = productFilter === tag
            return (
              <button
                key={tag}
                onClick={() => setProductFilter(tag)}
                style={{
                  fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.06em',
                  padding: '4px 12px', borderRadius: '14px', cursor: 'pointer',
                  border: `1px solid ${isActive ? '#c9a96e' : '#2a2a2a'}`,
                  background: isActive ? 'rgba(201,169,110,0.1)' : '#0a0a0a',
                  color: isActive ? '#c9a96e' : '#555',
                }}
              >
                {tag === 'ALL' ? 'All' : tag === 'JSU' ? 'JSU / Memory' : 'JZK / Językozak'}
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
          background: '#0a0a0a', border: '1px dashed #333', borderRadius: '8px',
          padding: '12px 16px', fontSize: '0.78rem', color: '#888', fontFamily: 'monospace', lineHeight: 1.6,
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
          background: '#0d0d0d', border: `1px solid ${bnColor}33`,
          borderLeft: `3px solid ${bnColor}`, borderRadius: '8px', padding: '14px 16px',
        }}>
          <div style={{ fontSize: '0.65rem', color: bnColor, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
            Gieniu's Diagnosis
          </div>
          <div style={{ fontSize: '0.82rem', color: '#ccc', lineHeight: 1.65, fontFamily: 'monospace' }}>
            {summary.diagnosis}
          </div>
        </div>
      )}

      {/* GIENIU response (from commands) */}
      {gieniuResponse && (
        <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '10px', padding: '16px' }}>
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
          <div style={{ fontSize: '0.65rem', color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '10px' }}>
            Webinar History {productFilter !== 'ALL' ? `· ${productFilter}` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.73rem', fontFamily: 'monospace', minWidth: '640px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#555' }}>
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
                {filteredSessions.map(s => (
                  <SessionRow
                    key={s.session_id}
                    s={s}
                    attendancePopulated={attendancePopulated}
                    purchasesMapped={purchasesMapped}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '4px', fontSize: '0.62rem', color: '#333', fontFamily: 'monospace' }}>
            n/p = attendance not populated · n/m = purchases not mapped yet
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
          background: '#0a0a0a', border: '1px dashed #2a2a2a',
          borderRadius: '10px', padding: '24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: '0.78rem', color: '#555', fontFamily: 'monospace', lineHeight: 1.8 }}>
            No JSU funnel data.
            <br /><br />
            Step 1: Run <code style={{ color: '#888' }}>supabase/webinar_funnel_schema.sql</code> in Supabase SQL Editor.
            <br />
            Step 2: Connect Make → ClickMeeting → webinar_sessions + webinar_participants.
            <br />
            Step 3: Connect Make → ESP → email_campaigns + email_recipient_events.
            <br /><br />
            Guide: <code style={{ color: '#888' }}>docs/clickmeeting_make_scenarios.md</code>
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
