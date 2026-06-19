import { GIENIU_VOICE_ID, GIENIU_VOICE_NAME } from '../config/gieniuVoice'
import { cleanForTTS, cleanForBrowserTTS } from './textClean'

console.log(`GIENIU voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

// ── localStorage keys ─────────────────────────────────────────────────────────

export const LS_TTS_PROVIDER   = 'gieniuTtsProvider'
export const LS_ELEVEN_PAUSED  = 'gieniuElevenLabsPaused'
export const LS_ELEVEN_REASON  = 'gieniuElevenLabsPausedReason'

export function isElevenLabsPaused(): boolean {
  try { return localStorage.getItem(LS_ELEVEN_PAUSED) === 'true' } catch { return false }
}

export function resetElevenLabs(): void {
  try {
    localStorage.removeItem(LS_ELEVEN_PAUSED)
    localStorage.removeItem(LS_ELEVEN_REASON)
    localStorage.setItem(LS_TTS_PROVIDER, 'elevenlabs')
  } catch { /* non-fatal */ }
}

function markElevenLabsPaused(reason: string): void {
  try {
    localStorage.setItem(LS_TTS_PROVIDER,  'browser')
    localStorage.setItem(LS_ELEVEN_PAUSED, 'true')
    localStorage.setItem(LS_ELEVEN_REASON, reason)
  } catch { /* non-fatal */ }
}

// ── Module-level audio state ──────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null
let currentFetchAbort: AbortController | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null

// AudioContext used to unlock browser autoplay policy during user gesture.
let _warmCtx: AudioContext | null = null

export function prewarmAudio(): void {
  try {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!AC) return
    if (!_warmCtx || _warmCtx.state === 'closed') _warmCtx = new AC()
    if (_warmCtx.state !== 'running') void _warmCtx.resume()
  } catch { /* non-fatal */ }
}

export function stopAudio(): void {
  if (currentFetchAbort) {
    currentFetchAbort.abort()
    currentFetchAbort = null
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio.src = ''
    currentAudio = null
  }
  try {
    window.speechSynthesis?.cancel()
  } catch { /* non-fatal */ }
  currentUtterance = null
  // eslint-disable-next-line no-console
  console.log('GIENIU interrupted')
}

// ── TTSResult ─────────────────────────────────────────────────────────────────

export interface TTSResult {
  ok: boolean
  provider: 'elevenlabs' | 'browser'
  aborted?: boolean
  error?: string
  fallbackFrom?: 'elevenlabs'
  reason?: string
}

// ── Error classification ──────────────────────────────────────────────────────

function isQuotaOrAuthError(err: string): boolean {
  return (
    /elevenStatus (401|402|403|429)/i.test(err) ||
    /quota_exceeded|quota exhausted|insufficient.credits|voice.unavailable/i.test(err) ||
    /HTTP (401|402|403|429)/i.test(err) ||
    /subscription|billing|limit reached|character.*limit/i.test(err)
  )
}

// ── Browser TTS ───────────────────────────────────────────────────────────────

function getBestPolishVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis?.getVoices() ?? []
    const polish  = voices.filter(v => v.lang.startsWith('pl'))
    const google  = polish.find(v => /google/i.test(v.name))
    return google ?? polish[0] ?? null
  } catch { return null }
}

async function speakBrowser(text: string): Promise<TTSResult> {
  const synth = window.speechSynthesis
  if (!synth) {
    return { ok: false, provider: 'browser', error: 'speechSynthesis not supported in this browser' }
  }

  // Cancel any prior browser TTS
  synth.cancel()
  currentUtterance = null

  // Wait up to 800 ms for voices to load if the list is empty
  if (synth.getVoices().length === 0) {
    await new Promise<void>(resolve => {
      const onVoices = () => resolve()
      synth.addEventListener('voiceschanged', onVoices, { once: true })
      setTimeout(resolve, 800)
    })
  }

  const utt = new SpeechSynthesisUtterance(text)
  utt.lang  = 'pl-PL'
  const voice = getBestPolishVoice()
  if (voice) utt.voice = voice
  currentUtterance = utt

  // eslint-disable-next-line no-console
  console.log(`GIENIU TTS browser: ${voice?.name ?? 'system default'} (${voice?.lang ?? 'pl-PL'})`)

  return new Promise<TTSResult>(resolve => {
    utt.onend = () => {
      if (currentUtterance === utt) currentUtterance = null
      resolve({ ok: true, provider: 'browser' })
    }
    utt.onerror = (e) => {
      if (currentUtterance === utt) currentUtterance = null
      const err = e.error ?? 'unknown'
      if (err === 'interrupted' || err === 'canceled') {
        resolve({ ok: false, provider: 'browser', aborted: true })
      } else {
        resolve({ ok: false, provider: 'browser', error: `browser tts: ${err}` })
      }
    }
    synth.speak(utt)
  })
}

// ── Main speak() ──────────────────────────────────────────────────────────────

export async function speak(text: string): Promise<TTSResult> {
  stopAudio()

  const cleaned = cleanForTTS(text)
  if (!cleaned.trim()) return { ok: false, provider: 'elevenlabs', error: 'empty text' }

  // If ElevenLabs is paused from a prior quota/auth error, go straight to browser TTS
  if (isElevenLabsPaused()) {
    // eslint-disable-next-line no-console
    console.log('GIENIU TTS: ElevenLabs paused — using browser TTS directly')
    return speakBrowser(cleanForBrowserTTS(cleaned))
  }

  // eslint-disable-next-line no-console
  console.log(`GIENIU frontend requested voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

  const ac = new AbortController()
  currentFetchAbort = ac

  try {
    const res = await fetch('/.netlify/functions/gieniu-tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: cleaned }),
      signal:  ac.signal,
    })
    currentFetchAbort = null

    if (res.ok) {
      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
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
        return { ok: true, provider: 'elevenlabs' }
      } catch (playErr) {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        const msg = String(playErr)
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS play failed:', msg)
        return { ok: false, provider: 'elevenlabs', error: msg }
      }

    } else {
      // Parse structured error from the Netlify function
      let errorMsg: string
      try {
        const json = await res.json() as {
          stage?: string; elevenStatus?: number; message?: string
          hasApiKey?: boolean; keyLength?: number; keyLooksQuoted?: boolean
          keyHasBearerPrefix?: boolean; keyHasWhitespace?: boolean; apiKeySource?: string
        }
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', json)
        const stage  = json.stage ?? 'unknown_stage'
        const status = json.elevenStatus ?? res.status
        const msg    = json.message ?? ''
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

      // ── Silent failover for quota / auth errors ───────────────────────────
      if (isQuotaOrAuthError(errorMsg)) {
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS quota/auth error — switching to browser TTS:', errorMsg)
        markElevenLabsPaused('quota_or_api_error')
        const browserResult = await speakBrowser(cleanForBrowserTTS(cleaned))
        return {
          ...browserResult,
          fallbackFrom: 'elevenlabs',
          reason:       'quota_or_api_error',
        }
      }

      return { ok: false, provider: 'elevenlabs', error: errorMsg }
    }
  } catch (err) {
    currentFetchAbort = null
    if ((err as Error)?.name === 'AbortError') {
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS fetch aborted')
      return { ok: false, provider: 'elevenlabs', aborted: true }
    }
    // eslint-disable-next-line no-console
    console.warn('GIENIU TTS network error:', err)
    return { ok: false, provider: 'elevenlabs', error: String(err) }
  }
}
