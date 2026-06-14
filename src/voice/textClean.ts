// Clean text before sending to TTS — replace English labels with Polish equivalents
// and normalize formatting so nothing weird is read aloud.

export function cleanForTTS(text: string): string {
  return text
    .replace(/\\n/g, '\n')                            // literal \n → real newline
    .replace(/\borders\b/gi, 'zamówienia')
    .replace(/\blink clicks\b/gi, 'kliknięć linku')
    .replace(/\bReal CPA\b/gi, 'realny koszt zakupu')
    .replace(/\bReal ROAS\b/gi, 'realny ROAS')
    .replace(/\bCPA\b/g, 'ce pe a')
    .replace(/\bROAS\b/g, 'roaas')
    .replace(/\bCPC\b/g, 'ce pe ce')
    .replace(/\bCTR\b/g, 'ce te er')
    .replace(/\bCPM\b/g, 'ce pe em')
    .replace(/(\d+)[.,](\d+)x\b/g, (_m, a, b) => `${a} przecinek ${b} raza`)
    .replace(/(\d+)x\b/g, (_m, a) => `${a} razy`)
    .replace(/zł/g, 'złotych')
    .replace(/—/g, '')
    .replace(/✓/g, '')
    .replace(/⚠/g, 'uwaga:')
    .replace(/•/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
