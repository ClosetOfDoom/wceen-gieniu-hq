// BriefCard — "Brief dnia" on HOME: the newest 09:00 brief (stanley-brief), sections folded, with a listen button
// (the same TTS path as the answers: Auto-speak voice). Numbers are the server's; nothing is computed here.
import { useEffect, useState, type ReactNode } from 'react'
import { fetchLatestBrief, type DailyBrief } from '../services/stanleyBrief'

export function BriefCard({ onSpeak, speaking, extra }: { onSpeak: (text: string) => void; speaking: boolean; extra?: ReactNode }) {
  const [brief, setBrief] = useState<DailyBrief | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetchLatestBrief().then((b) => { setBrief(b); setError(null) }).catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }, [])

  return (
    <div className="panel-illuminate card">
      <div className="section-title section-title-gold" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Brief dnia{brief ? ` · ${brief.date}` : ''}</span>
        <span style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {brief && (
            <button type="button" className="btn-sm" onClick={() => onSpeak(brief.speech)} aria-pressed={speaking}>
              {speaking ? '■ Stop' : '🔊 Odsłuchaj'}
            </button>
          )}
          {extra}
        </span>
      </div>
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--amber)' }}>BRAK DANYCH: stanley-brief ({error})</div>}
      {brief === undefined && !error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)' }}>Ładuję brief…</div>}
      {brief === null && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)' }}>Jeszcze nie ma briefu. Pierwszy powstanie o 09:00.</div>}
      {brief && (
        <>
          {brief.intro && <p style={{ margin: '0 0 10px', fontSize: '0.9rem', lineHeight: 1.45 }}>{brief.intro}</p>}
          {(open ? brief.sections : brief.sections.filter((s) => s.id === 'sprzedaz' || s.id === 'uwaga')).map((s) => (
            <div key={s.id} style={{ marginBottom: '8px' }}>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text2)', letterSpacing: '0.06em' }}>{s.title}</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '0.82rem', lineHeight: 1.45 }}>
                {s.lines.map((l, i) => <li key={i} style={{ overflowWrap: 'anywhere' }}>{l}</li>)}
              </ul>
            </div>
          ))}
          <button type="button" className="btn-sm" onClick={() => setOpen(!open)} style={{ marginTop: '4px' }}>
            {open ? 'Zwiń' : 'Pokaż cały brief'}
          </button>
          <div style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--muted2)' }}>
            Liczby policzył kod{brief.llm.used ? `; wstęp napisał model (${brief.llm.provider}), zdania z liczbą spoza briefu usunięte: ${brief.llm.removed}` : '; bez wstępu modelu'}.
          </div>
        </>
      )}
    </div>
  )
}
