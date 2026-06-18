import { GIENIU_VOICE_ID, GIENIU_VOICE_NAME } from '../config/gieniuVoice'
import { cleanForTTS } from './textClean'

console.log(`GIENIU voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

// Module-level audio state — only one active at a time
let currentAudio: HTMLAudioElement | null = null
let currentFetchAbort: AbortController | null = null

export function stopAudio(): void {
  // Abort any in-flight TTS fetch first — this is the key fix
  if (currentFetchAbort) {
    currentFetchAbort.abort()
    currentFetchAbort = null
  }
  // Stop audio element
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio.src = ''
    currentAudio = null
  }
  window.speechSynthesis?.cancel()
  // eslint-disable-next-line no-console
  console.log('GIENIU interrupted')
}

export interface TTSResult {
  ok: boolean
  source: 'elevenlabs'
  aborted?: boolean
  error?: string
}

export async function speak(text: string): Promise<TTSResult> {
  stopAudio() // stop any previous audio + abort previous fetch

  const cleaned = cleanForTTS(text)
  if (!cleaned.trim()) return { ok: false, source: 'elevenlabs', error: 'empty text' }

  // eslint-disable-next-line no-console
  console.log(`GIENIU frontend requested voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

  const ac = new AbortController()
  currentFetchAbort = ac

  try {
    const res = await fetch('/.netlify/functions/eleven-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned }),
      signal: ac.signal,
    })
    currentFetchAbort = null

    if (res.ok) {
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio

      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
      }

      try {
        await audio.play()
        // eslint-disable-next-line no-console
        console.log(`GIENIU TTS audio playing (ElevenLabs ${GIENIU_VOICE_NAME})`)
        return { ok: true, source: 'elevenlabs' }
      } catch (playErr) {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        const msg = String(playErr)
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS play failed:', msg)
        return { ok: false, source: 'elevenlabs', error: msg }
      }
    } else {
      const errText = await res.text().catch(() => res.status.toString())
      // eslint-disable-next-line no-console
      console.warn(`GIENIU TTS failed: ElevenLabs HTTP ${res.status}`, errText)
      return { ok: false, source: 'elevenlabs', error: `HTTP ${res.status}: ${errText.slice(0, 120)}` }
    }
  } catch (err) {
    currentFetchAbort = null
    if ((err as Error)?.name === 'AbortError') {
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS fetch aborted')
      return { ok: false, source: 'elevenlabs', aborted: true }
    }
    // eslint-disable-next-line no-console
    console.warn('GIENIU TTS network error:', err)
    return { ok: false, source: 'elevenlabs', error: String(err) }
  }
}
