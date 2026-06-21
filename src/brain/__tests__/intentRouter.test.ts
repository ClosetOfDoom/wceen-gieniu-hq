import { describe, it, expect } from 'vitest'
import { detectIntent, detectLanguage, normalizeQuery } from '../intentRouter'

describe('normalizeQuery', () => {
  it('strips Polish diacritics', () => {
    expect(normalizeQuery('Jak się uczyć')).toBe('jak sie uczyc')
  })
  it('lowercases', () => {
    expect(normalizeQuery('ILE NA CZYSTO')).toBe('ile na czysto')
  })
  it('collapses whitespace', () => {
    expect(normalizeQuery('  ile   na  czysto  ')).toBe('ile na czysto')
  })
})

describe('detectLanguage', () => {
  it('Polish diacritics → pl', () => {
    expect(detectLanguage('Ile na czysto?')).toBe('pl')
  })
  it('Polish keyword "jak" → pl', () => {
    expect(detectLanguage('jak idzie dzisiaj')).toBe('pl')
  })
  it('English only → en', () => {
    expect(detectLanguage('how are we doing today')).toBe('en')
  })
  it('mixed PL+EN → mixed', () => {
    expect(detectLanguage('Ile orders today')).toBe('mixed')
  })
})

describe('detectIntent — Polish queries', () => {
  it('"ile na czysto" → profit_today', () => {
    const r = detectIntent('ile na czysto')
    expect(r.intent).toBe('profit_today')
    expect(r.confidence).toBeGreaterThanOrEqual(0.4)
  })
  it('"jak idzie dzisiaj" → revenue_today', () => {
    const r = detectIntent('jak idzie dzisiaj')
    expect(r.intent).toBe('revenue_today')
  })
  it('"czemu kurs jak sie uczyc sie nie sprzedaje" → jsu_funnel', () => {
    const r = detectIntent('czemu kurs jak sie uczyc sie nie sprzedaje')
    expect(r.intent).toBe('jsu_funnel')
    expect(r.confidence).toBeGreaterThan(0.7)
  })
  it('"co z danymi" → data_health', () => {
    expect(detectIntent('co z danymi').intent).toBe('data_health')
  })
  it('"co przepala kase" → retargeting', () => {
    expect(detectIntent('co przepala kase').intent).toBe('retargeting')
  })
})

describe('detectIntent — English queries', () => {
  it('"how much profit today" → profit_today', () => {
    const r = detectIntent('how much profit today')
    expect(r.intent).toBe('profit_today')
  })
  it('"how are we doing" → revenue_today', () => {
    expect(detectIntent('how are we doing').intent).toBe('revenue_today')
  })
  it('"campaign performance" → campaigns_today', () => {
    expect(detectIntent('campaign performance').intent).toBe('campaigns_today')
  })
  it('"red flags" → red_flags', () => {
    expect(detectIntent('red flags').intent).toBe('red_flags')
  })
})

describe('detectIntent — edge cases', () => {
  it('single unknown word → normal_chat', () => {
    expect(detectIntent('cat').intent).toBe('normal_chat')
  })
  it('empty string → normal_chat', () => {
    expect(detectIntent('').intent).toBe('normal_chat')
  })
  it('confidence is between 0 and 1', () => {
    const r = detectIntent('ile na czysto')
    expect(r.confidence).toBeGreaterThanOrEqual(0)
    expect(r.confidence).toBeLessThanOrEqual(1)
  })
})
