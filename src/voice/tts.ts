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

  try {
    const res = await fetch('/.netlify/functions/eleven-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned, voiceId: DEFAULT_VOICE_ID }),
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      currentAudio = new Audio(url)
      currentAudio.onended = () => URL.revokeObjectURL(url)
      await currentAudio.play()
      return { ok: true, source: 'elevenlabs' }
    }
  } catch {
    // fall through to browser TTS
  }

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
  return { ok: true, source: 'browser' }
}
