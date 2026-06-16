import type { AutomationRun } from '../services/data'

interface Props {
  runs: AutomationRun[]
  loading: boolean
}

function timeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr ago`
  return `${Math.floor(hrs / 24)} days ago`
}

export function AutomationRuns({ runs, loading }: Props) {
  if (loading) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem', padding: '12px 0' }}>
        Loading automation runs...
      </div>
    )
  }
  if (runs.length === 0) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem', padding: '12px 0' }}>
        No automation data.
      </div>
    )
  }

  return (
    <div>
      <div
        style={{
          fontSize: '0.7rem',
          color: '#555',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '10px',
        }}
      >
        Make Automation Runs
      </div>
      {runs.map(run => (
        <div
          key={run.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '7px 0',
            borderBottom: '1px solid #1a1a1a',
          }}
        >
          <div>
            <div style={{ fontSize: '0.8rem', color: '#ccc', fontFamily: 'monospace' }}>
              {run.scenario_name}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#555', marginTop: '2px' }}>
              {timeSince(run.ran_at)} · {run.rows_inserted ?? 0} rows
            </div>
          </div>
          <span
            style={{
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              color: run.status === 'success' ? '#00ff88' : '#ff6b00',
              fontWeight: 700,
            }}
          >
            {run.status}
          </span>
        </div>
      ))}
    </div>
  )
}
