import { GIENIU_VOICE_ID, GIENIU_VOICE_NAME } from '../config/gieniuVoice'
import { cleanForTTS } from './textClean'

console.log(`GIENIU voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

// Module-level audio state — only one active at a time
let currentAudio: HTMLAudioElement | null = null
let currentFetchAbort: AbortController | null = null

// AudioContext used to unlock browser autoplay policy during user gesture.
// Call prewarmAudio() synchronously inside a click handler (before any await)
// so that subsequent audio.play() calls succeed even after async TTS fetch.
let _warmCtx: AudioContext | null = null

export function prewarmAudio(): void {
  try {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!AC) return
    if (!_warmCtx || _warmCtx.state === 'closed') {
      _warmCtx = new AC()
    }
    if (_warmCtx.state !== 'running') {
      void _warmCtx.resume()
    }
  } catch {
    // non-fatal — older browsers without AudioContext
  }
}

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
    const res = await fetch('/.netlify/functions/gieniu-tts', {
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
      // Try to parse structured error from the function
      let errorMsg: string
      try {
        const json = await res.json() as {
          stage?: string
          elevenStatus?: number
          message?: string
          hasApiKey?: boolean
          keyLength?: number
          keyLooksQuoted?: boolean
          keyHasBearerPrefix?: boolean
          keyHasWhitespace?: boolean
          apiKeySource?: string
        }
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', json)
        const stage  = json.stage ?? 'unknown_stage'
        const status = json.elevenStatus ?? res.status
        const msg    = json.message ?? ''

        // Include key diagnostics in error string so getTtsErrorMessage can pattern-match
        const keyInfo = [
          json.keyHasBearerPrefix && 'bearerPrefix',
          json.keyLooksQuoted     && 'quotedKey',
          json.keyHasWhitespace   && 'whitespace',
          json.apiKeySource       && `src:${json.apiKeySource}`,
          json.keyLength != null  && `len:${json.keyLength}`,
        ].filter(Boolean).join(',')

        errorMsg = `HTTP ${res.status}: ${stage} / elevenStatus ${status} — ${msg}${keyInfo ? ` [${keyInfo}]` : ''}`
      } catch {
        const errText = await res.text().catch(() => res.status.toString())
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail (non-JSON)', errText.slice(0, 200))
        errorMsg = `HTTP ${res.status}: ${errText.slice(0, 200)}`
      }
      return { ok: false, source: 'elevenlabs', error: errorMsg }
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
