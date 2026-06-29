// Text cleaning before TTS.
//
// cleanForTTS        — ElevenLabs (Stanley, English voice)
// cleanForEnglishTTS — Browser English voice (fallback)

// ── Shared base (pure normalization, no language-specific transforms) ──────────

function cleanBase(text: string): string {
  return text
    .replace(/\\n/g, '\n')                        // literal \n → real newline
    .replace(/zł/g, 'PLN')                        // zł → PLN (ł is non-ASCII, \b won't fire)
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

// ── ElevenLabs (Stanley, English voice) ──────────────────────────────────────

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

