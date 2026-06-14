import { speak, stopAudio } from '../voice/tts'
import { useState } from 'react'

interface Props {
  text: string
}

export function GieniuResponse({ text }: Props) {
  const [speaking, setSpeaking] = useState(false)
  const [voiceSource, setVoiceSource] = useState<string | null>(null)

  async function handleSpeak() {
    if (speaking) {
      stopAudio()
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    const result = await speak(text)
    setVoiceSource(result.source)
    setSpeaking(false)
  }

  if (!text) return null

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #2a2a2a',
        borderRadius: '12px',
        padding: '20px 24px',
        marginTop: '16px',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: '#e8ff00',
          fontFamily: 'monospace',
          letterSpacing: '0.1em',
          marginBottom: '12px',
          textTransform: 'uppercase',
        }}
      >
        GIENIU
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          fontFamily: 'monospace',
          fontSize: '0.88rem',
          lineHeight: 1.7,
          color: '#e0e0e0',
        }}
      >
        {text}
      </pre>
      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button className="btn-sm" onClick={handleSpeak}>
          {speaking ? '⏹ Stop' : '▶ Czytaj'}
        </button>
        {voiceSource && (
          <span style={{ fontSize: '0.7rem', color: '#555', alignSelf: 'center' }}>
            via {voiceSource}
          </span>
        )}
      </div>
    </div>
  )
}
