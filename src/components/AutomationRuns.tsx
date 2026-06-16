import type { AutomationRun } from '../services/data'

interface Props {
  runs: AutomationRun[]
  loading: boolean
}

function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function AutomationRuns({ runs, loading }: Props) {
  if (loading) {
    return <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', padding: '8px 0' }}>Loading automation runs…</div>
  }
  if (runs.length === 0) {
    return <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', padding: '8px 0' }}>No automation data.</div>
  }

  return (
    <div>
      <div className="panel-label">Make Automation Runs</div>
      {runs.map(run => (
        <div key={run.id} style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 0',
          borderBottom: '1px solid rgba(38, 55, 90, 0.4)',
        }}>
          <div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
              {run.scenario_name}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--muted2)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {timeSince(run.ran_at)} · {run.rows_inserted ?? 0} rows
            </div>
          </div>
          <span style={{
            fontSize: '0.65rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: run.status === 'success' ? 'var(--emerald)' : 'var(--orange)',
          }}>
            {run.status}
          </span>
        </div>
      ))}
    </div>
  )
}
