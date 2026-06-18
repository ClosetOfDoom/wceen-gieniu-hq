import { speak, stopAudio } from '../voice/tts'
import { useState } from 'react'

interface Props {
  text: string
  compact?: boolean
}

export function GieniuResponse({ text, compact }: Props) {
  const [speaking, setSpeaking] = useState(false)

  async function handleSpeak() {
    if (speaking) { stopAudio(); setSpeaking(false); return }
    setSpeaking(true)
    const res = await speak(text)
    setSpeaking(false)
    if (!res.ok && !res.aborted) console.warn('GieniuResponse TTS failed:', res.error)
  }

  if (!text) return null

  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border-gold)',
      borderLeft: '3px solid var(--gold)',
      borderRadius: '4px',
      padding: compact ? '12px 14px' : '16px 20px',
      marginTop: compact ? 0 : '14px',
    }}>
      <div style={{
        fontFamily: 'var(--font-serif)',
        fontSize: '0.58rem',
        color: 'var(--gold)',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        marginBottom: '10px',
      }}>
        Gieniu Says
      </div>
      <pre style={{
        margin: 0,
        whiteSpace: 'pre-wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? '0.78rem' : '0.84rem',
        lineHeight: 1.75,
        color: 'var(--text)',
      }}>
        {text}
      </pre>
      <div style={{ marginTop: '12px' }}>
        <button className="btn-sm" onClick={handleSpeak}>
          {speaking ? '⏹ Stop' : '▶ Read aloud'}
        </button>
      </div>
    </div>
  )
}
