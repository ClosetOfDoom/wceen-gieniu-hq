// Clean text before sending to TTS.
// cleanForTTS: normalizes for ElevenLabs (English voice).
// cleanForBrowserTTS: additional English→Polish substitutions for browser Polish voice.

export function cleanForTTS(text: string): string {
  return text
    .replace(/\\n/g, '\n')                             // literal \n → real newline
    .replace(/\bzł\b/g, 'PLN')                         // zł → PLN
    .replace(/\bPLN\b/g, 'P L N')                      // spell out for TTS
    .replace(/(\d),(\d)/g, '$1.$2')                    // decimal comma → decimal point
    .replace(/(\d+\.\d+)x\b/g, '$1 razy')              // 1.10x → 1.10 razy
    .replace(/(\d+)x\b/g, '$1 razy')                   // 3x → 3 razy
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
    .replace(/\blink clicks?\b/gi, 'kliknięcia')        // link clicks → Polish
    .replace(/—/g, '')
    .replace(/✓/g, '')
    .replace(/⚠/g, 'Uwaga:')
    .replace(/•/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function cleanForBrowserTTS(text: string): string {
  // Apply base clean, then English→Polish substitutions for browser Polish voice
  return cleanForTTS(text)
    .replace(/\borders?\b/gi, 'zamówień')              // orders → zamówień
    .replace(/\brevenue\b/gi, 'przychód')
    .replace(/\bspend\b/gi, 'wydatki')
    .replace(/\bpurchases?\b/gi, 'zakupy')
    .replace(/\bimpressions?\b/gi, 'wyświetlenia')
    .replace(/\bcampaigns?\b/gi, 'kampania')
    .replace(/\bconversions?\b/gi, 'konwersje')
    .replace(/\bclicks?\b/gi, 'kliknięcia')
    .replace(/\bwebinar\b/gi, 'webinar')               // unchanged — already Polish-friendly
    .replace(/\bstale\b/gi, 'nieaktualne')
    .replace(/\bsource\b/gi, 'źródło')
    .trim()
}
