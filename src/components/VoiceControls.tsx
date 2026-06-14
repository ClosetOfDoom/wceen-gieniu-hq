import { useState } from 'react'
import {
  DEFAULT_VOICE_ID, getVoiceId, setVoiceId, resetVoice,
  fetchVoices, testVoice, type ElevenVoice,
} from '../voice/tts'

export function VoiceControls() {
  const [voices, setVoices] = useState<ElevenVoice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [currentVoice, setCurrentVoice] = useState(getVoiceId())

  async function handleLoadVoices() {
    setLoadingVoices(true)
    setTestResult(null)
    try {
      const v = await fetchVoices()
      setVoices(v)
    } catch {
      setTestResult('Błąd pobierania głosów — sprawdź ELEVENLABS_API_KEY.')
    } finally {
      setLoadingVoices(false)
    }
  }

  async function handleTestVoice(voiceId: string) {
    setTestResult(`Testuję głos ${voiceId}...`)
    const r = await testVoice(voiceId, 'Cześć Lifidi, tu Gieniu. Testuje głos.')
    setTestResult(r.ok ? `OK: ${voiceId}` : `Błąd: ${r.error}`)
  }

  function handleSetRoger() {
    setVoiceId(DEFAULT_VOICE_ID)
    setCurrentVoice(DEFAULT_VOICE_ID)
    setTestResult(`Ustawiono Rogera: ${DEFAULT_VOICE_ID}`)
  }

  function handleReset() {
    resetVoice()
    setCurrentVoice(DEFAULT_VOICE_ID)
    setTestResult('Głos zresetowany.')
  }

  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #2a2a2a',
        borderRadius: '12px',
        padding: '20px',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: '#555',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '14px',
        }}
      >
        Voice layer
      </div>

      <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '12px', fontFamily: 'monospace' }}>
        Aktywny głos: <span style={{ color: '#e8ff00' }}>{currentVoice}</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button className="btn-sm" onClick={handleSetRoger}>Ustaw Rogera</button>
        <button className="btn-sm" onClick={handleReset}>Reset głosu</button>
        <button className="btn-sm" onClick={handleLoadVoices} disabled={loadingVoices}>
          {loadingVoices ? 'Ładuję...' : 'Testuj głosy 11Labs'}
        </button>
      </div>

      {testResult && (
        <div style={{ fontSize: '0.78rem', color: '#888', fontFamily: 'monospace', marginBottom: '12px' }}>
          {testResult}
        </div>
      )}

      {voices.length > 0 && (
        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {voices.map(v => (
            <div
              key={v.voice_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #1a1a1a',
              }}
            >
              <span style={{ fontSize: '0.78rem', color: '#ccc', fontFamily: 'monospace' }}>
                {v.name}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn-xs" onClick={() => handleTestVoice(v.voice_id)}>Test</button>
                <button
                  className="btn-xs"
                  onClick={() => { setVoiceId(v.voice_id); setCurrentVoice(v.voice_id) }}
                >
                  Użyj
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
