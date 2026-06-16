// Clean text before sending to TTS.
// Normalizes English output so nothing sounds broken when read aloud.

export function cleanForTTS(text: string): string {
  return text
    .replace(/\\n/g, '\n')                             // literal \n → real newline
    .replace(/\bzł\b/g, 'PLN')                         // zł → PLN
    .replace(/\bPLN\b/g, 'P L N')                      // spell out for TTS
    .replace(/(\d),(\d)/g, '$1.$2')                    // decimal comma → decimal point
    .replace(/(\d+\.\d+)x\b/g, '$1 times')             // 3.03x → 3.03 times
    .replace(/(\d+)x\b/g, '$1 times')                  // 3x → 3 times
    .replace(/\bROAS\b/g, 'R O A S')
    .replace(/\bCPA\b/g, 'C P A')
    .replace(/\bCTR\b/g, 'C T R')
    .replace(/\bCPC\b/g, 'C P C')
    .replace(/\bCPM\b/g, 'C P M')
    .replace(/\bESP\b/g, 'E S P')
    .replace(/\bLTV\b/g, 'L T V')
    .replace(/\bJSU\b/g, 'J S U')
    .replace(/\bJZK\b/g, 'J Z K')
    .replace(/\bWCSEEN\b/gi, 'W C E E N')
    .replace(/—/g, '')
    .replace(/✓/g, '')
    .replace(/⚠/g, 'Warning:')
    .replace(/•/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
