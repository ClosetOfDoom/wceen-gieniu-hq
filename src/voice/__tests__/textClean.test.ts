import { describe, it, expect } from 'vitest'
import { cleanForTTS, cleanForEnglishTTS, cleanForPolishTTS } from '../textClean'

describe('cleanForTTS (ElevenLabs English — George)', () => {
  it('converts zł to PLN, then PLN to P L N', () => {
    expect(cleanForTTS('Zysk: 340 zł')).toBe('Zysk: 340 P L N')
  })
  it('spells out CPA as C P A', () => {
    expect(cleanForTTS('CPA wynosi 120')).toContain('C P A')
  })
  it('spells out JSU as J S U', () => {
    expect(cleanForTTS('kurs JSU sprzedał się')).toContain('J S U')
  })
  it('converts decimal comma to decimal point', () => {
    expect(cleanForTTS('ROAS 2,5x')).toContain('2.5')
  })
  it('converts Nx to N times', () => {
    expect(cleanForTTS('ROAS 3x')).toContain('3 times')
    expect(cleanForTTS('ROAS 2.5x')).toContain('2.5 times')
  })
  it('converts ⚠ to Warning:', () => {
    expect(cleanForTTS('⚠ dane nieaktualne')).toContain('Warning:')
  })
  it('strips em-dash', () => {
    expect(cleanForTTS('A — B')).not.toContain('—')
  })
  it('collapses multiple spaces', () => {
    expect(cleanForTTS('one   two')).toBe('one   two'.replace(/[^\S\n]+/g, ' ').trim())
  })
})

describe('cleanForEnglishTTS (browser EN)', () => {
  it('PLN → Polish zloty', () => {
    expect(cleanForEnglishTTS('earned 500 PLN')).toContain('Polish zloty')
  })
  it('ROAS → return on ad spend', () => {
    expect(cleanForEnglishTTS('ROAS 3.2x')).toContain('return on ad spend')
  })
  it('3x → 3 times', () => {
    expect(cleanForEnglishTTS('3x better')).toContain('3 times')
  })
})

describe('cleanForPolishTTS (browser PL)', () => {
  it('zł → PLN → P L N (not Polish zloty)', () => {
    const r = cleanForPolishTTS('200 zł')
    expect(r).toContain('P L N')
    expect(r).not.toContain('Polish zloty')
  })
  it('ROAS → R O A S', () => {
    expect(cleanForPolishTTS('ROAS 2x')).toContain('R O A S')
  })
  it('2x → 2 razy', () => {
    expect(cleanForPolishTTS('2x lepiej')).toContain('2 razy')
  })
  it('orders → zamówień', () => {
    expect(cleanForPolishTTS('5 orders')).toContain('zamówień')
  })
  it('revenue → przychód', () => {
    expect(cleanForPolishTTS('revenue today')).toContain('przychód')
  })
  it('⚠ → Uwaga:', () => {
    expect(cleanForPolishTTS('⚠ coś jest nie tak')).toContain('Uwaga:')
  })
})

describe('cross-path — zł always converts to PLN first', () => {
  it('cleanForTTS: zł first becomes PLN then P L N', () => {
    expect(cleanForTTS('100 zł profit')).toContain('P L N')
  })
  it('cleanForPolishTTS: zł becomes PLN then P L N', () => {
    expect(cleanForPolishTTS('100 zł')).toContain('P L N')
  })
})
