// "Włącz powiadomienia" — once on the phone: the 09:00 "Brief gotowy" push (opens HOME). Shows the state when already on.
import { useEffect, useState } from 'react'
import { enablePush, pushState, type PushState } from '../lib/push'

const note = (color: string) => ({ fontSize: '0.66rem', color })

export function PushButton() {
  const [state, setState] = useState<PushState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { pushState().then(setState).catch(() => setState('unsupported')) }, [])
  if (state === null) return null
  if (state === 'enabled') return <span style={note('var(--muted)')}>🔔 powiadomienia włączone</span>
  if (state === 'unsupported') {
    return <span style={note('var(--muted)')} title="Na iPhonie: najpierw Udostępnij → Do ekranu początkowego, potem otwórz Stanleya z ikony.">powiadomienia niedostępne w tej przeglądarce</span>
  }
  if (state === 'denied') return <span style={note('var(--amber)')}>powiadomienia zablokowane w ustawieniach przeglądarki</span>
  return (
    <>
      <button
        type="button"
        className="btn-sm"
        onClick={() => { setError(null); enablePush().then(setState).catch((e: unknown) => setError(String((e as Error)?.message ?? e))) }}
      >
        🔔 Włącz powiadomienia
      </button>
      {error && <span style={note('var(--amber)')}>{error}</span>}
    </>
  )
}
