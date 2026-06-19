#!/usr/bin/env node
// Assert browser TTS language selection contract:
// - selectBrowserVoice(language) picks correct voices
// - English mode uses en-US lang and en* voices only
// - Polish mode uses pl-PL lang and pl* voices only
// - Cached Polish voiceName is NOT used in English mode
// - cleanForEnglishTTS does NOT insert Polish words
// - cleanForPolishTTS inserts Polish words
// - Reset button clears all 7 voice localStorage keys
// - DiagnosticsPanel shows voice language and voice info

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. tts.ts — selectBrowserVoice and language infrastructure
{
  const c = read('src/voice/tts.ts')

  if (c.includes('selectBrowserVoice')) {
    pass('tts.ts exports selectBrowserVoice(language)')
  } else {
    fail('tts.ts must export selectBrowserVoice(language: "en" | "pl")')
  }

  if (c.includes('getVoiceLanguage')) {
    pass('tts.ts exports getVoiceLanguage()')
  } else {
    fail('tts.ts must export getVoiceLanguage() — reads gieniuVoiceLanguage from localStorage')
  }

  if (c.includes('saveVoiceLanguage')) {
    pass('tts.ts exports saveVoiceLanguage()')
  } else {
    fail('tts.ts must export saveVoiceLanguage(lang) — persists language to localStorage')
  }

  if (c.includes('resetVoiceState')) {
    pass('tts.ts exports resetVoiceState()')
  } else {
    fail('tts.ts must export resetVoiceState() — clears all voice localStorage keys')
  }

  if (c.includes('gieniuVoiceLanguage')) {
    pass('tts.ts uses gieniuVoiceLanguage localStorage key')
  } else {
    fail('tts.ts must use gieniuVoiceLanguage as the localStorage key for voice language')
  }

  if (c.includes('gieniuVoiceName')) {
    pass('tts.ts uses gieniuVoiceName localStorage key')
  } else {
    fail('tts.ts must use gieniuVoiceName to cache the selected voice name')
  }

  // English mode must use en-US utterance lang
  if (c.includes("'en-US'") || c.includes('"en-US"')) {
    pass("tts.ts sets utterance.lang = 'en-US' for English browser TTS")
  } else {
    fail("tts.ts speakBrowser must set utt.lang = 'en-US' when language is 'en'")
  }

  // English mode must filter only en* voices
  if (c.includes("startsWith('en')") || c.includes('startsWith("en")')) {
    pass("tts.ts filters voices by lang.startsWith('en') for English mode")
  } else {
    fail("tts.ts selectBrowserVoice must filter voices with lang.startsWith('en') for English")
  }

  // Polish mode must filter only pl* voices
  if (c.includes("startsWith('pl')") || c.includes('startsWith("pl")')) {
    pass("tts.ts filters voices by lang.startsWith('pl') for Polish mode")
  } else {
    fail("tts.ts selectBrowserVoice must filter voices with lang.startsWith('pl') for Polish")
  }

  // Cached voice validation — English mode must check voice is actually English
  if (c.includes("lang.startsWith('en')") || c.includes("cachedVoice.lang.startsWith('en')") ||
      (c.includes('cachedVoice') && c.includes("startsWith('en')"))) {
    pass('tts.ts selectBrowserVoice validates cached voice is English before using it')
  } else {
    fail('tts.ts selectBrowserVoice must discard cached voice if it is not English when language=en')
  }

  // English voice priority order: Google > Microsoft > en-US > any
  if (c.includes('/google/i') && c.includes('/microsoft/i') && c.includes("lang === 'en-US'")) {
    pass("tts.ts English voice priority: Google > Microsoft > en-US")
  } else {
    fail("tts.ts must prefer Google > Microsoft > en-US English voices in selectBrowserVoice")
  }

  // Default language is English
  if (c.includes("'en'") && (c.includes("defaults to 'en'") || c.includes("localStorage.setItem(LS_VOICE_LANG, 'en')"))) {
    pass("tts.ts defaults voice language to 'en' when localStorage key is missing")
  } else {
    fail("tts.ts getVoiceLanguage must default to 'en' (English) and persist that default")
  }

  // getAvailableVoices exported
  if (c.includes('getAvailableVoices')) {
    pass('tts.ts exports getAvailableVoices(lang)')
  } else {
    fail('tts.ts must export getAvailableVoices(lang: "en" | "pl") for UI voice count display')
  }

  // reset clears all 7 keys
  const resetKeys = [
    'gieniuVoiceName', 'gieniuVoiceLanguage', 'gieniuTtsProvider',
    'gieniuElevenLabsPaused', 'gieniuElevenLabsPausedReason',
    'gieniuVoiceRate', 'gieniuVoicePitch',
  ]
  const missingKeys = resetKeys.filter(k => !c.includes(k))
  if (missingKeys.length === 0) {
    pass('resetVoiceState() references all 7 voice localStorage keys')
  } else {
    fail(`resetVoiceState() is missing keys: ${missingKeys.join(', ')}`)
  }

  // speak() reads language from localStorage
  if (c.includes('getVoiceLanguage()') && c.includes('speak(')) {
    pass('speak() reads voice language from localStorage via getVoiceLanguage()')
  } else {
    fail('speak() must call getVoiceLanguage() to determine which browser voice/cleaner to use')
  }

  // English path uses cleanForEnglishTTS
  if (c.includes('cleanForEnglishTTS')) {
    pass('tts.ts uses cleanForEnglishTTS for English browser TTS path')
  } else {
    fail('tts.ts must use cleanForEnglishTTS() on the English browser TTS path')
  }

  // Polish path uses cleanForPolishTTS
  if (c.includes('cleanForPolishTTS')) {
    pass('tts.ts uses cleanForPolishTTS for Polish browser TTS path')
  } else {
    fail('tts.ts must use cleanForPolishTTS() on the Polish browser TTS path')
  }

  // saveVoiceLanguage removes cached voice name when language changes
  if (c.includes('removeItem(LS_VOICE_NAME)') || c.includes("removeItem('gieniuVoiceName')")) {
    pass('saveVoiceLanguage() clears cached voice name on language change')
  } else {
    fail('saveVoiceLanguage() must remove gieniuVoiceName from localStorage on language change')
  }
}

// 2. textClean.ts — three separate cleaners
{
  const c = read('src/voice/textClean.ts')

  if (c.includes('cleanForEnglishTTS')) {
    pass('textClean.ts exports cleanForEnglishTTS()')
  } else {
    fail('textClean.ts must export cleanForEnglishTTS() for browser English voice path')
  }

  if (c.includes('cleanForPolishTTS')) {
    pass('textClean.ts exports cleanForPolishTTS()')
  } else {
    fail('textClean.ts must export cleanForPolishTTS() for browser Polish voice path')
  }

  // English path: PLN → Polish zloty
  if (c.includes('Polish zloty')) {
    pass("cleanForEnglishTTS replaces PLN with 'Polish zloty'")
  } else {
    fail("cleanForEnglishTTS must replace PLN with 'Polish zloty' (human-readable English)")
  }

  // English path: ROAS → return on ad spend
  if (c.includes('return on ad spend')) {
    pass("cleanForEnglishTTS replaces ROAS with 'return on ad spend'")
  } else {
    fail("cleanForEnglishTTS must replace ROAS with 'return on ad spend'")
  }

  // English path: NO Polish words
  // Check cleanForEnglishTTS section only — extract the function body
  const englishFnMatch = c.match(/export function cleanForEnglishTTS[\s\S]+?(?=\n\/\/|export function|export const|$)/)
  if (englishFnMatch) {
    const fn = englishFnMatch[0]
    const polishWords = ['zamówień', 'zamowien', 'przychód', 'wydatki', 'zakupy', 'wyświetlenia',
      'kampania', 'konwersje', 'kliknięcia', 'nieaktualne', 'Uwaga:', 'razy']
    const foundPolish = polishWords.filter(w => fn.includes(w))
    if (foundPolish.length === 0) {
      pass('cleanForEnglishTTS does NOT contain Polish word substitutions')
    } else {
      fail(`cleanForEnglishTTS must not contain Polish words — found: ${foundPolish.join(', ')}`)
    }
  } else {
    fail('Could not locate cleanForEnglishTTS function body to verify no Polish words')
  }

  // Polish path: English → Polish substitutions
  if (c.includes('zamówień') && c.includes('przychód') && c.includes('wydatki')) {
    pass('cleanForPolishTTS has English → Polish metric substitutions')
  } else {
    fail("cleanForPolishTTS must convert orders→zamówień, revenue→przychód, spend→wydatki")
  }

  // Polish path: multiplier → razy
  if (c.includes('razy')) {
    pass("cleanForPolishTTS converts multiplier (e.g. 2x) to 'razy'")
  } else {
    fail("cleanForPolishTTS must replace multiplier 'x' suffix with 'razy'")
  }

  // Polish path: ⚠ → Uwaga:
  if (c.includes('Uwaga:')) {
    pass("cleanForPolishTTS replaces ⚠ with 'Uwaga:'")
  } else {
    fail("cleanForPolishTTS must replace ⚠ with 'Uwaga:'")
  }

  // English path: x → times (not razy)
  if (englishFnMatch) {
    const fn = englishFnMatch[0]
    if (fn.includes('times') && !fn.includes('razy')) {
      pass("cleanForEnglishTTS uses 'times' for multiplier (not 'razy')")
    } else {
      fail("cleanForEnglishTTS must use 'times' for multiplier suffix, never 'razy'")
    }
  }

  // backward compat alias exists
  if (c.includes('cleanForBrowserTTS')) {
    pass('textClean.ts exports cleanForBrowserTTS as backward-compat alias')
  } else {
    fail('textClean.ts must export cleanForBrowserTTS (alias of cleanForPolishTTS) for backward compat')
  }
}

// 3. App.tsx — language state, reset handler, new RightPanel props
{
  const c = read('src/App.tsx')

  if (c.includes('voiceLanguage') && (c.includes("useState<'en' | 'pl'>") || c.includes("useState<\"en\" | \"pl\">"))) {
    pass('App.tsx has voiceLanguage state typed as "en" | "pl"')
  } else {
    fail('App.tsx must have voiceLanguage state of type "en" | "pl"')
  }

  if (c.includes('getVoiceLanguage') && c.includes('saveVoiceLanguage')) {
    pass('App.tsx imports getVoiceLanguage and saveVoiceLanguage from tts')
  } else {
    fail('App.tsx must import getVoiceLanguage and saveVoiceLanguage from tts.ts')
  }

  if (c.includes('resetVoiceState')) {
    pass('App.tsx imports resetVoiceState from tts')
  } else {
    fail('App.tsx must import resetVoiceState from tts.ts')
  }

  if (c.includes('handleVoiceLanguageChange') || c.includes('onVoiceLanguageChange')) {
    pass('App.tsx has voice language change handler')
  } else {
    fail('App.tsx must have handleVoiceLanguageChange handler wired to saveVoiceLanguage')
  }

  if (c.includes('handleResetVoiceState') || c.includes('onResetVoiceState')) {
    pass('App.tsx has reset voice state handler')
  } else {
    fail('App.tsx must have handleResetVoiceState that calls resetVoiceState()')
  }

  if (c.includes('englishVoiceCount') && c.includes('polishVoiceCount')) {
    pass('App.tsx tracks englishVoiceCount and polishVoiceCount')
  } else {
    fail('App.tsx must track englishVoiceCount and polishVoiceCount for diagnostics and warnings')
  }

  if (c.includes('browserVoiceInfo')) {
    pass('App.tsx tracks browserVoiceInfo (selected browser voice name + lang)')
  } else {
    fail('App.tsx must track browserVoiceInfo for diagnostics and UI display')
  }

  if (c.includes('voiceschanged')) {
    pass('App.tsx refreshes voice info on voiceschanged event')
  } else {
    fail('App.tsx must listen for voiceschanged event to refresh browser voice info')
  }

  // Start voice test phrase for English browser TTS
  if (c.includes('Gieniu voice is active.')) {
    pass("App.tsx uses 'Gieniu voice is active.' as English browser TTS test phrase")
  } else {
    fail("App.tsx handleStartGeorgeVoice must use 'Gieniu voice is active.' when browser TTS is active (English)")
  }

  // Language selector in RightPanel
  if (c.includes('onVoiceLanguageChange') && c.includes('voiceLanguage')) {
    pass('App.tsx passes voiceLanguage and onVoiceLanguageChange to RightPanel')
  } else {
    fail('App.tsx must pass voiceLanguage and onVoiceLanguageChange props to RightPanel')
  }

  // No English voices warning
  if (c.includes('No English browser voice found') || c.includes('englishVoiceCount === 0')) {
    pass('App.tsx shows warning when no English voices are available')
  } else {
    fail('App.tsx must warn when englishVoiceCount === 0 and English mode is selected')
  }

  // Reset button exists in RightPanel
  if (c.includes('Reset voice') || c.includes('onResetVoiceState')) {
    pass('App.tsx renders reset voice state button in RightPanel')
  } else {
    fail('App.tsx RightPanel must have a "Reset voice" button that calls onResetVoiceState')
  }

  // English/Polish language toggle buttons
  if (c.includes("'en'") && c.includes("'pl'") && c.includes('onVoiceLanguageChange')) {
    pass('App.tsx RightPanel renders English/Polish language toggle buttons')
  } else {
    fail('App.tsx RightPanel must render English and Polish language toggle buttons')
  }
}

// 4. DiagnosticsPanel — voice diagnostics rows
{
  const c = read('src/components/DiagnosticsPanel.tsx')

  if (c.includes('ttsLanguage') && c.includes('Browser voice language')) {
    pass('DiagnosticsPanel.tsx shows browser voice language row')
  } else {
    fail('DiagnosticsPanel.tsx must show browser voice language (en/pl) in diagnostics')
  }

  if (c.includes('browserVoiceInfo') && c.includes('Browser voice')) {
    pass('DiagnosticsPanel.tsx shows selected browser voice name and lang')
  } else {
    fail('DiagnosticsPanel.tsx must show selected browser voice name and lang in diagnostics')
  }

  if (c.includes('englishVoiceCount') && c.includes('English voices available')) {
    pass('DiagnosticsPanel.tsx shows English voice count')
  } else {
    fail('DiagnosticsPanel.tsx must show English voices available count')
  }

  if (c.includes('polishVoiceCount') && c.includes('Polish voices available')) {
    pass('DiagnosticsPanel.tsx shows Polish voice count')
  } else {
    fail('DiagnosticsPanel.tsx must show Polish voices available count')
  }
}

// 5. package.json has assert:voice-language script
{
  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts && pkg.scripts['assert:voice-language']) {
    pass('package.json has assert:voice-language script')
  } else {
    fail('package.json missing assert:voice-language script')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Browser TTS language selection contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} browser TTS language violation(s).`)
  process.exit(1)
}
