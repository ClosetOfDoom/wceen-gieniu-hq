#!/usr/bin/env node
// Assert voice TTS fallback contract:
// ElevenLabs quota/auth errors → silent browser TTS fallback.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. tts.ts has speakBrowser function
{
  const c = read('src/voice/tts.ts')

  if (c.includes('speakBrowser')) {
    pass('tts.ts defines speakBrowser()')
  } else {
    fail('tts.ts must define speakBrowser() for browser TTS fallback')
  }

  if (c.includes('isElevenLabsPaused')) {
    pass('tts.ts exports isElevenLabsPaused()')
  } else {
    fail('tts.ts must export isElevenLabsPaused()')
  }

  if (c.includes('resetElevenLabs')) {
    pass('tts.ts exports resetElevenLabs()')
  } else {
    fail('tts.ts must export resetElevenLabs()')
  }

  if (c.includes('gieniuElevenLabsPaused')) {
    pass('tts.ts uses gieniuElevenLabsPaused localStorage key')
  } else {
    fail('tts.ts must set gieniuElevenLabsPaused localStorage flag on quota error')
  }

  if (c.includes('gieniuTtsProvider')) {
    pass('tts.ts uses gieniuTtsProvider localStorage key')
  } else {
    fail('tts.ts must set gieniuTtsProvider localStorage key')
  }

  // Error detection covers all quota/auth statuses
  if (/401.*402.*403.*429/i.test(c) || (c.includes('401') && c.includes('402') && c.includes('403') && c.includes('429'))) {
    pass('tts.ts detects 401/402/403/429 ElevenLabs errors')
  } else {
    fail('tts.ts isQuotaOrAuthError must cover 401, 402, 403, 429')
  }

  if (c.includes('quota_exceeded') || c.includes('quota exhausted') || c.includes('insufficient')) {
    pass('tts.ts detects quota_exceeded / insufficient_credits text errors')
  } else {
    fail('tts.ts isQuotaOrAuthError must check for quota_exceeded, insufficient_credits in error text')
  }

  // On quota error: fallover to browser, NOT return { ok: false }
  if (c.includes('fallbackFrom') && c.includes("'elevenlabs'")) {
    pass('tts.ts returns fallbackFrom: elevenlabs on browser fallback')
  } else {
    fail('tts.ts must return { fallbackFrom: "elevenlabs" } when browser fallback triggers')
  }

  if (c.includes('cleanForPolishTTS') || c.includes('cleanForEnglishTTS') || c.includes('cleanForBrowserTTS')) {
    pass('tts.ts cleans text before calling speakBrowser()')
  } else {
    fail('tts.ts must clean text (cleanForPolishTTS / cleanForEnglishTTS) before calling speakBrowser()')
  }

  // TTSResult must have provider field
  if (c.includes("provider: 'elevenlabs' | 'browser'") || c.includes("'elevenlabs' | 'browser'")) {
    pass("TTSResult.provider includes 'browser' as possible value")
  } else {
    fail("TTSResult must have provider: 'elevenlabs' | 'browser'")
  }

  // browser TTS prefers pl-PL
  if (c.includes('pl-PL') && c.includes("startsWith('pl')")) {
    pass('speakBrowser() sets lang=pl-PL and prefers Polish voices')
  } else {
    fail("speakBrowser() must set utt.lang='pl-PL' and filter voices by lang.startsWith('pl')")
  }

  // Google polish voice preference
  if (c.includes("'google'") || c.includes('/google/i')) {
    pass('speakBrowser() prefers Google Polish voice')
  } else {
    fail("speakBrowser() must prefer 'Google' named Polish voice")
  }

  // Interrupted treated as aborted not error
  if (c.includes("'interrupted'") || c.includes('"interrupted"')) {
    pass("speakBrowser() treats 'interrupted' as aborted (not user-facing error)")
  } else {
    fail("speakBrowser() must handle e.error === 'interrupted' as aborted, not error")
  }
}

// 2. textClean.ts has cleanForBrowserTTS
{
  const c = read('src/voice/textClean.ts')

  if (c.includes('cleanForBrowserTTS')) {
    pass('textClean.ts exports cleanForBrowserTTS()')
  } else {
    fail('textClean.ts must export cleanForBrowserTTS() for browser TTS Polish cleanup')
  }

  if (c.includes('zamówień') || c.includes('zamowien')) {
    pass('cleanForBrowserTTS translates "orders" to Polish')
  } else {
    fail('cleanForBrowserTTS must replace "orders" with "zamówień" for browser Polish voice')
  }

  if (c.includes('kliknięcia') || c.includes('klikniecia')) {
    pass('cleanForBrowserTTS translates "link clicks" to Polish')
  } else {
    fail('cleanForBrowserTTS must replace "link clicks" with "kliknięcia"')
  }
}

// 3. App.tsx handles browser fallback silently (no blocking error)
{
  const c = read('src/App.tsx')

  if (c.includes('ttsFallbackActive') && c.includes('setTtsFallbackActive')) {
    pass('App.tsx has ttsFallbackActive state')
  } else {
    fail('App.tsx must have ttsFallbackActive state to track browser TTS mode')
  }

  if (c.includes('isElevenLabsPaused') && c.includes('resetElevenLabs')) {
    pass('App.tsx imports isElevenLabsPaused and resetElevenLabs from tts')
  } else {
    fail('App.tsx must import isElevenLabsPaused and resetElevenLabs from tts.ts')
  }

  if (c.includes("result.provider === 'browser'") || c.includes("provider === 'browser'")) {
    pass("App.tsx checks result.provider === 'browser' for silent fallback handling")
  } else {
    fail("App.tsx must check result.provider === 'browser' instead of treating it as an error")
  }

  if (c.includes('handleRetryElevenLabs') || c.includes('onRetryElevenLabs')) {
    pass('App.tsx has retry ElevenLabs handler')
  } else {
    fail('App.tsx must have handleRetryElevenLabs function for "Try ElevenLabs again" button')
  }

  if (c.includes('Try ElevenLabs again')) {
    pass('App.tsx renders "Try ElevenLabs again" button')
  } else {
    fail('App.tsx must render "Try ElevenLabs again" button when ttsFallbackActive')
  }

  // The blocking error must NOT appear when fallback is active
  if (c.includes('!ttsFallbackActive') && c.includes('ttsError')) {
    pass('ttsError is suppressed when ttsFallbackActive (no blocking error shown to user)')
  } else {
    fail('App.tsx must hide ttsError when ttsFallbackActive (browser TTS is running fine)')
  }

  if (c.includes('ElevenLabs limit reached') || c.includes('switched to Browser TTS')) {
    pass('App.tsx shows calm "ElevenLabs limit reached — switched to Browser TTS" status')
  } else {
    fail('App.tsx must show calm fallback notice, not a blocking error, when browser TTS is active')
  }

  // ttsLastElevenError stored for diagnostics
  if (c.includes('ttsLastElevenError') || c.includes('ttsLastElevenLabsError')) {
    pass('App.tsx tracks last ElevenLabs error for Diagnostics')
  } else {
    fail('App.tsx must track last ElevenLabs error separately for Diagnostics panel')
  }
}

// 4. DiagnosticsPanel shows TTS provider status and last error
{
  const c = read('src/components/DiagnosticsPanel.tsx')

  if (c.includes('ttsFallbackActive') || c.includes('ttsLastElevenError')) {
    pass('DiagnosticsPanel.tsx shows TTS fallback status / last error')
  } else {
    fail('DiagnosticsPanel.tsx must display TTS provider state and last ElevenLabs error (for debugging)')
  }

  if (c.includes('Browser TTS') || c.includes('ElevenLabs paused')) {
    pass('DiagnosticsPanel.tsx shows "Browser TTS" when ElevenLabs is paused')
  } else {
    fail('DiagnosticsPanel.tsx TTS voice row must reflect browser fallback state')
  }
}

// 5. package.json has assert:tts-fallback script
{
  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts && pkg.scripts['assert:tts-fallback']) {
    pass('package.json has assert:tts-fallback script')
  } else {
    fail('package.json missing assert:tts-fallback script')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — TTS fallback contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} TTS fallback violation(s).`)
  process.exit(1)
}
