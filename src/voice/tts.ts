import { cleanForTTS } from './textClean'

export const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb' // George — British narrator

let currentAudio: HTMLAudioElement | null = null

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  window.speechSynthesis?.cancel()
}

export interface TTSResult {
  ok: boolean
  source: 'elevenlabs' | 'browser'
  error?: string
}

export async function speak(text: string): Promise<TTSResult> {
  stopAudio()
  const cleaned = cleanForTTS(text)

  // eslint-disable-next-line no-console
  console.log('GIENIU TTS request started')

  try {
    const res = await fetch('/.netlify/functions/eleven-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned, voiceId: DEFAULT_VOICE_ID }),
    })

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
        console.log('GIENIU TTS audio playing (ElevenLabs George)')
        return { ok: true, source: 'elevenlabs' }
      } catch (playErr) {
        URL.revokeObjectURL(url)
        currentAudio = null
        const msg = String(playErr)
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS failed:', msg)
        return { ok: false, source: 'elevenlabs', error: msg }
      }
    } else {
      const errText = await res.text().catch(() => res.status.toString())
      // eslint-disable-next-line no-console
      console.warn(`GIENIU TTS failed: ElevenLabs HTTP ${res.status}`, errText)
    }
  } catch (networkErr) {
    // eslint-disable-next-line no-console
    console.warn('GIENIU TTS failed: network error', networkErr)
  }

  // Browser TTS fallback
  return speakBrowser(cleaned)
}

export function speakBrowser(text: string): TTSResult {
  if (!window.speechSynthesis) {
    return { ok: false, source: 'browser', error: 'speechSynthesis not supported' }
  }
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-GB'
  utt.rate = 1.0
  window.speechSynthesis.speak(utt)
  // eslint-disable-next-line no-console
  console.log('GIENIU TTS audio playing (browser fallback)')
  return { ok: true, source: 'browser' }
}
