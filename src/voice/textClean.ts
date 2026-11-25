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


// ── Long text: never cut mid-sentence, never one huge utterance ───────────────

/** Sentences of a text (keeps the end punctuation); a text with no punctuation is one piece. */
function sentencesOf(text: string): string[] {
  // A sentence ends at . ! ? followed by a space or the end, so "4 321.00 PLN" and "61.2%" are never cut in two.
  return text.match(/[\s\S]+?(?:[.!?]+["')\]]*(?=\s|$)|\n+|$)/g)?.map(s => s.trim()).filter(Boolean) ?? [text.trim()].filter(Boolean)
}

/**
 * Pieces of at most `max` characters, split at sentence ends (an over-long sentence is split at a comma or a space).
 * Chrome's speech synthesis silently stops one long utterance after about 15 seconds, so the browser voice speaks
 * piece by piece.
 */
export function splitForSpeech(text: string, max = 170): string[] {
  const out: string[] = []
  let cur = ''
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const sentence of sentencesOf(text)) {
    if (sentence.length > max) {
      flush()
      let rest = sentence
      while (rest.length > max) {
        const head = rest.slice(0, max)
        const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' '))
        const at = cut > max * 0.4 ? cut + 1 : max
        out.push(rest.slice(0, at).trim())
        rest = rest.slice(at)
      }
      cur = rest
    } else if ((cur + ' ' + sentence).trim().length > max) {
      flush()
      cur = sentence
    } else {
      cur = (cur + ' ' + sentence).trim()
    }
  }
  flush()
  return out
}

/** At most `max` characters, ending at a sentence end (so the voice finishes a thought instead of stopping mid-word). */
export function cutAtSentence(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('.\n'))
  return end > max * 0.3 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max)
}
