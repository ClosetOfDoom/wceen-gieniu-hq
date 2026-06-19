// Text cleaning before TTS.
//
// cleanForTTS        — ElevenLabs (George, English voice)
// cleanForEnglishTTS — Browser English voice
// cleanForPolishTTS  — Browser Polish voice
// cleanForBrowserTTS — backward-compat alias for cleanForPolishTTS

// ── Shared base (pure normalization, no language-specific transforms) ──────────

function cleanBase(text: string): string {
  return text
    .replace(/\\n/g, '\n')                        // literal \n → real newline
    .replace(/\bzł\b/g, 'PLN')                   // zł → PLN for all paths
    .replace(/(\d),(\d)/g, '$1.$2')              // decimal comma → decimal point
    .replace(/—/g, '')
    .replace(/✓/g, '')
    .replace(/•/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Abbreviations spelled out as letters (shared by all paths)
function spellAbbrevs(text: string): string {
  return text
    .replace(/\bCPA\b/g, 'C P A')
    .replace(/\bCTR\b/g, 'C T R')
    .replace(/\bCPC\b/g, 'C P C')
    .replace(/\bCPM\b/g, 'C P M')
    .replace(/\bESP\b/g, 'E S P')
    .replace(/\bLTV\b/g, 'L T V')
    .replace(/\bJSU\b/g, 'J S U')
    .replace(/\bJZK\b/g, 'J Z K')
    .replace(/\bWCSEEN\b/gi, 'W C E E N')
}

// ── ElevenLabs (George, English voice) ───────────────────────────────────────

export function cleanForTTS(text: string): string {
  return spellAbbrevs(cleanBase(text))
    .replace(/\bPLN\b/g, 'P L N')
    .replace(/\bROAS\b/g, 'R O A S')
    .replace(/(\d+\.\d+)x\b/g, '$1 times')
    .replace(/(\d+)x\b/g, '$1 times')
    .replace(/⚠/g, 'Warning:')
    .trim()
}

// ── Browser English voice ─────────────────────────────────────────────────────
// Human-readable English expansions — no Polish words.

export function cleanForEnglishTTS(text: string): string {
  return spellAbbrevs(cleanBase(text))
    .replace(/\bPLN\b/g, 'Polish zloty')
    .replace(/\bROAS\b/g, 'return on ad spend')
    .replace(/(\d+\.\d+)x\b/g, '$1 times')
    .replace(/(\d+)x\b/g, '$1 times')
    .replace(/⚠/g, 'Warning:')
    .trim()
}

// ── Browser Polish voice ──────────────────────────────────────────────────────
// English metric labels → Polish equivalents for a Polish speech voice.

export function cleanForPolishTTS(text: string): string {
  return spellAbbrevs(cleanBase(text))
    .replace(/\bPLN\b/g, 'P L N')
    .replace(/\bROAS\b/g, 'R O A S')
    .replace(/(\d+\.\d+)x\b/g, '$1 razy')
    .replace(/(\d+)x\b/g, '$1 razy')
    .replace(/\blink clicks?\b/gi, 'kliknięcia')
    .replace(/\borders?\b/gi, 'zamówień')
    .replace(/\brevenue\b/gi, 'przychód')
    .replace(/\bspend\b/gi, 'wydatki')
    .replace(/\bpurchases?\b/gi, 'zakupy')
    .replace(/\bimpressions?\b/gi, 'wyświetlenia')
    .replace(/\bcampaigns?\b/gi, 'kampania')
    .replace(/\bconversions?\b/gi, 'konwersje')
    .replace(/\bclicks?\b/gi, 'kliknięcia')
    .replace(/\bstale\b/gi, 'nieaktualne')
    .replace(/\bsource\b/gi, 'źródło')
    .replace(/⚠/g, 'Uwaga:')
    .trim()
}

// Backward-compat alias — existing call sites still work
export const cleanForBrowserTTS = cleanForPolishTTS
