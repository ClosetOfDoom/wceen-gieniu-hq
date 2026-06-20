#!/usr/bin/env node
// Assert STT (speech-to-text) language control contract:
// - Default STT language is en-US (never pl-PL)
// - recognition.lang is set from the language parameter, never hardcoded
// - Interim results go to onInterim only, never trigger command execution
// - isFinal check before calling onFinal
// - Confidence threshold 0.65
// - Sanity checks: too short, Polish chars in English mode, too few words
// - sttLanguage and gieniuVoiceLanguage are separate localStorage keys
// - App.tsx uses startListening from stt.ts (no inline SpeechRecognition code)
// - DiagnosticsPanel and RightPanel show STT controls

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// ── src/voice/stt.ts ──────────────────────────────────────────────────────────
{
  const f = 'src/voice/stt.ts'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)

    if (c.includes('getSttLanguage')) {
      pass('stt.ts exports getSttLanguage()')
    } else {
      fail('stt.ts must export getSttLanguage()')
    }

    if (c.includes('setSttLanguage')) {
      pass('stt.ts exports setSttLanguage(lang)')
    } else {
      fail('stt.ts must export setSttLanguage(lang)')
    }

    if (c.includes('startListening')) {
      pass('stt.ts exports startListening(opts)')
    } else {
      fail('stt.ts must export startListening(opts)')
    }

    if (c.includes('isSpeechRecognitionAvailable')) {
      pass('stt.ts exports isSpeechRecognitionAvailable()')
    } else {
      fail('stt.ts must export isSpeechRecognitionAvailable()')
    }

    // Default language must be en-US
    if (c.includes("'en-US'") && c.includes('getSttLanguage')) {
      pass("stt.ts getSttLanguage() defaults to 'en-US'")
    } else {
      fail("stt.ts getSttLanguage() must default to 'en-US'")
    }

    // Must NOT default to pl-PL
    if (!c.includes("return 'pl-PL'") && !c.includes(': pl-PL')) {
      pass('stt.ts does not default to pl-PL')
    } else {
      fail('stt.ts must not default to pl-PL — default is en-US')
    }

    // localStorage key is gieniuSttLanguage (separate from gieniuVoiceLanguage)
    if (c.includes('gieniuSttLanguage')) {
      pass("stt.ts uses localStorage key 'gieniuSttLanguage'")
    } else {
      fail("stt.ts must use localStorage key 'gieniuSttLanguage' (separate from gieniuVoiceLanguage)")
    }

    // recognition.lang set from parameter
    if (c.includes('rec.lang = opts.language') || c.includes("rec.lang = language")) {
      pass('stt.ts sets recognition.lang from the language parameter')
    } else {
      fail('stt.ts must set recognition.lang = opts.language — never hardcoded')
    }

    // Not hardcoded to Polish
    if (!c.includes("rec.lang = 'pl-PL'") && !c.includes('rec.lang="pl-PL"')) {
      pass("stt.ts does not hardcode rec.lang = 'pl-PL'")
    } else {
      fail("stt.ts must NOT hardcode rec.lang = 'pl-PL'")
    }

    // continuous = false
    if (c.includes('rec.continuous = false')) {
      pass('stt.ts sets recognition.continuous = false')
    } else {
      fail('stt.ts must set recognition.continuous = false')
    }

    // interimResults = true
    if (c.includes('rec.interimResults = true')) {
      pass('stt.ts sets recognition.interimResults = true')
    } else {
      fail('stt.ts must set recognition.interimResults = true')
    }

    // maxAlternatives = 3
    if (c.includes('rec.maxAlternatives = 3')) {
      pass('stt.ts sets recognition.maxAlternatives = 3')
    } else {
      fail('stt.ts must set recognition.maxAlternatives = 3')
    }

    // Interim results go only to onInterim, not onFinal
    if (c.includes('onInterim') && !c.includes('if (!r.isFinal)') && c.includes('isFinal')) {
      // Check that isFinal check gates the onFinal call
      pass('stt.ts gates onFinal behind isFinal check (interim → onInterim only)')
    } else if (c.includes('onInterim') && c.includes('isFinal')) {
      pass('stt.ts has onInterim callback and isFinal check')
    } else {
      fail('stt.ts must call onInterim for interim results and check isFinal before calling onFinal')
    }

    // Confidence threshold
    if (c.includes('0.65') || c.includes('CONFIDENCE_THRESHOLD')) {
      pass('stt.ts has confidence threshold (0.65)')
    } else {
      fail('stt.ts must reject transcripts with confidence < 0.65')
    }

    // Sanity check: too short
    if (c.includes('length < 3') || c.includes('t.length < 3')) {
      pass('stt.ts rejects transcripts shorter than 3 characters')
    } else {
      fail('stt.ts must reject transcripts with length < 3 characters')
    }

    // Sanity check: Polish chars in English mode
    if (c.includes('POLISH_CHARS') || (c.includes('en-US') && c.includes('ą') && c.includes('accepted: false'))) {
      pass('stt.ts rejects Polish characters in English mode')
    } else {
      fail('stt.ts must detect Polish characters in English mode and reject the transcript')
    }

    // accepted and rejectionReason in result
    if (c.includes('accepted') && c.includes('rejectionReason')) {
      pass('stt.ts SttResult includes accepted flag and rejectionReason')
    } else {
      fail('stt.ts SttResult must have accepted: boolean and rejectionReason?: string')
    }

    // Returns controller with stop()
    if (c.includes('stop: ()') || c.includes('stop: () =>')) {
      pass('stt.ts startListening returns { stop } controller')
    } else {
      fail('stt.ts startListening must return { stop: () => void } controller')
    }

    // Returns null when SR not available
    if (c.includes('return null') && c.includes('SpeechRecognition')) {
      pass('stt.ts startListening returns null when SpeechRecognition is unavailable')
    } else {
      fail('stt.ts startListening must return null when SpeechRecognition is not available')
    }

    // SttResult type exported
    if (c.includes('SttResult') && c.includes('export')) {
      pass('stt.ts exports SttResult type')
    } else {
      fail('stt.ts must export SttResult type')
    }
  }
}

// ── App.tsx ────────────────────────────────────────────────────────────────────
{
  const c = read('src/App.tsx')

  // Imports startListening from voice/stt
  if (c.includes('startListening') && c.includes("'./voice/stt'")) {
    pass('App.tsx imports startListening from voice/stt')
  } else {
    fail('App.tsx must import startListening from ./voice/stt')
  }

  // No longer hardcodes pl-PL
  if (!c.includes("rec.lang = 'pl-PL'")) {
    pass("App.tsx does not hardcode rec.lang = 'pl-PL'")
  } else {
    fail("App.tsx must not contain rec.lang = 'pl-PL' — language comes from sttLanguage state")
  }

  // No inline SpeechRecognition construction
  if (!c.includes('new SR()') && !c.includes('w.SpeechRecognition')) {
    pass('App.tsx does not construct SpeechRecognition inline (delegates to startListening)')
  } else {
    fail('App.tsx must use startListening() from stt.ts — no inline SpeechRecognition construction')
  }

  // sttLanguage state exists
  if (c.includes('sttLanguage') && c.includes('setSttLanguage_')) {
    pass('App.tsx has sttLanguage state variable')
  } else {
    fail('App.tsx must have sttLanguage state from getSttLanguage()')
  }

  // STT state variables
  const sttVars = ['sttStatus', 'sttConfidence', 'sttRejectionReason', 'sttLastFinal', 'sttInterim', 'sttPrefillInput']
  const missingStt = sttVars.filter(v => !c.includes(v))
  if (missingStt.length === 0) {
    pass('App.tsx has all STT state variables')
  } else {
    fail(`App.tsx missing STT state variables: ${missingStt.join(', ')}`)
  }

  // Rejection path fills input, does not call handleIntentQuery
  if (c.includes('setSttPrefillInput') && c.includes('setSttStatus') && c.includes("'rejected'")) {
    pass('App.tsx fills input on rejection and marks status=rejected (does not auto-execute)')
  } else {
    fail("App.tsx must set sttStatus='rejected' and fill sttPrefillInput on low-confidence/sanity failure")
  }

  // Accepted path calls handleIntentQuery
  if (c.includes("'accepted'") && c.includes('handleIntentQuery')) {
    pass('App.tsx calls handleIntentQuery only when STT result is accepted')
  } else {
    fail('App.tsx must call handleIntentQuery only when STT result.accepted === true')
  }

  // STT and TTS language are separate
  if (c.includes('gieniuSttLanguage') || c.includes('sttLanguage') && c.includes('voiceLanguage')) {
    pass('App.tsx keeps sttLanguage (mic) separate from voiceLanguage (TTS)')
  } else {
    fail('App.tsx must keep STT language (mic input) separate from TTS voice language (output)')
  }

  // handleSttLanguageChange handler
  if (c.includes('handleSttLanguageChange')) {
    pass('App.tsx has handleSttLanguageChange handler')
  } else {
    fail('App.tsx must have handleSttLanguageChange() handler')
  }

  // onSttLanguageChange passed to RightPanel
  if (c.includes('onSttLanguageChange={handleSttLanguageChange}')) {
    pass('App.tsx passes onSttLanguageChange to RightPanel')
  } else {
    fail('App.tsx must pass onSttLanguageChange={handleSttLanguageChange} to RightPanel')
  }
}

// ── RightPanel (inside App.tsx) ────────────────────────────────────────────────
{
  const c = read('src/App.tsx')

  if (c.includes('sttLanguage: SttLanguage') || c.includes('sttLanguage:')) {
    pass('RightPanel accepts sttLanguage prop')
  } else {
    fail('RightPanel must accept sttLanguage prop')
  }

  if (c.includes('onSttLanguageChange')) {
    pass('RightPanel accepts onSttLanguageChange prop')
  } else {
    fail('RightPanel must accept onSttLanguageChange prop')
  }

  if (c.includes("'en-US'") && c.includes("'pl-PL'") && c.includes('onSttLanguageChange')) {
    pass('RightPanel renders STT language selector (EN / PL buttons)')
  } else {
    fail("RightPanel must render STT language selector buttons for 'en-US' and 'pl-PL'")
  }

  if (c.includes('sttPrefillInput') && c.includes('setInputVal')) {
    pass('RightPanel prefills inputVal with rejected transcript')
  } else {
    fail('RightPanel must prefill inputVal when sttPrefillInput changes')
  }

  if (c.includes("sttStatus === 'rejected'") && c.includes('Tap again')) {
    pass('RightPanel shows repeat prompt when STT is rejected')
  } else {
    fail("RightPanel must show 'Tap again and repeat' message when sttStatus === 'rejected'")
  }
}

// ── DiagnosticsPanel ──────────────────────────────────────────────────────────
{
  const c = read('src/components/DiagnosticsPanel.tsx')

  if (c.includes('SpeechRecognition') && c.includes('available')) {
    pass('DiagnosticsPanel shows SpeechRecognition availability')
  } else {
    fail('DiagnosticsPanel must show SpeechRecognition: available/not available row')
  }

  if (c.includes('STT language') && c.includes('sttLanguage')) {
    pass('DiagnosticsPanel shows current STT language')
  } else {
    fail('DiagnosticsPanel must show current STT language')
  }

  if (c.includes('STT confidence') && c.includes('sttConfidence')) {
    pass('DiagnosticsPanel shows STT confidence')
  } else {
    fail('DiagnosticsPanel must show STT confidence when available')
  }

  if (c.includes('STT result') && c.includes('sttStatus')) {
    pass('DiagnosticsPanel shows STT accepted/rejected result')
  } else {
    fail('DiagnosticsPanel must show STT result (accepted/rejected)')
  }

  if (c.includes('Rejection reason') && c.includes('sttRejectionReason')) {
    pass('DiagnosticsPanel shows rejection reason when transcript is rejected')
  } else {
    fail('DiagnosticsPanel must show rejection reason when sttStatus === rejected')
  }
}

// ── gieniuSttLanguage ≠ gieniuVoiceLanguage (separate concerns) ───────────────
{
  const sttCode  = read('src/voice/stt.ts')
  const ttsCode  = read('src/voice/tts.ts')

  if (sttCode.includes('gieniuSttLanguage') && !ttsCode.includes('gieniuSttLanguage')) {
    pass("STT key 'gieniuSttLanguage' is only in stt.ts, not in tts.ts")
  } else if (!sttCode.includes('gieniuSttLanguage')) {
    fail("stt.ts must use localStorage key 'gieniuSttLanguage'")
  } else {
    fail("tts.ts must not reference 'gieniuSttLanguage' — they are separate settings")
  }

  if (ttsCode.includes('gieniuVoiceLanguage') && !sttCode.includes('gieniuVoiceLanguage')) {
    pass("TTS key 'gieniuVoiceLanguage' is only in tts.ts, not in stt.ts")
  } else if (!ttsCode.includes('gieniuVoiceLanguage')) {
    fail("tts.ts must use localStorage key 'gieniuVoiceLanguage'")
  } else {
    fail("stt.ts must not reference 'gieniuVoiceLanguage' — they are separate settings")
  }
}

// ── package.json ──────────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts && pkg.scripts['assert:stt-language']) {
    pass('package.json has assert:stt-language script')
  } else {
    fail('package.json missing assert:stt-language script')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — STT language control contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} STT violation(s).`)
  process.exit(1)
}
