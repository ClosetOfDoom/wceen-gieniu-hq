// TodayPanel — "Dziś" on HOME: the day rhythm (stanley-wiedza/rytm-dnia.md) + Stanley's tasks, with hours and ticking.
// Tasks are added in the Q&A ("dodaj zadanie … jutro o 10") and ticked here or with "zrobione …".
import { useCallback, useEffect, useState } from 'react'
import { fetchDayPlan, toggleDayItem, type DayPlan } from '../services/stanleyDay'

export function TodayPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [plan, setPlan] = useState<DayPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchDayPlan().then((p) => { setPlan(p); setError(null) }).catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  async function toggle(id: string) {
    if (!plan) return
    setBusy(id)
    try {
      const done = await toggleDayItem(id, plan.date)
      setPlan({ ...plan, items: plan.items.map((i) => (i.id === id ? { ...i, done } : i)) })
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="panel-illuminate card">
      <div className="section-title section-title-gold" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <span>Dziś{plan ? ` · ${plan.date}` : ''}</span>
        {plan?.filarDnia && <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>filar dnia: {plan.filarDnia}</span>}
      </div>
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--amber)' }}>BRAK DANYCH: stanley-tasks ({error})</div>}
      {!plan && !error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)' }}>Ładuję plan dnia…</div>}
      {plan && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '4px' }}>
          {plan.items.map((i) => (
            <li key={i.id}>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'baseline', cursor: 'pointer', opacity: i.done ? 0.55 : 1 }}>
                <input type="checkbox" checked={i.done} disabled={busy === i.id} onChange={() => toggle(i.id)} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', minWidth: '92px', color: 'var(--text2)' }}>
                  {i.time ? `${i.time}${i.end ? `–${i.end}` : ''}` : 'bez godziny'}
                </span>
                <span style={{ fontSize: '0.86rem', textDecoration: i.done ? 'line-through' : 'none', overflowWrap: 'anywhere' }}>
                  {i.title}
                  {i.kind === 'zadanie' && <span style={{ marginLeft: '6px', fontSize: '0.66rem', color: 'var(--muted)' }}>ZADANIE{i.overdue ? ' · zaległe' : ''}</span>}
                </span>
              </label>
            </li>
          ))}
          {plan.items.length === 0 && <li style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>Nic w planie.</li>}
        </ul>
      )}
      <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted2)' }}>
        Zadania dodasz w rozmowie ze Stanleyem: „dodaj zadanie … jutro o 10”, „zrobione …”, „co dziś?”.
      </div>
    </div>
  )
}
