// English only: Stanley's TTS is English, so no source may carry a rule that demands Polish output. Polish USER input is
// understood (regexes, product names), but every answer, brief and spoken line is English.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { FINANCE_RULES } from '../netlify/shared/financeStanley.js'
import { BRIEF_SYSTEM, TRANSLATE_SYSTEM } from '../netlify/shared/dailyBrief.js'

const ROOT = join(__dirname, '..')
const SKIP_DIR = new Set(['node_modules', 'dist', '.netlify', '__tests__', 'fixtures', 'i18n'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out)
    } else if (/\.(js|mjs|ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(p)
  }
  return out
}

// A rule that demands Polish output. English phrases and Polish phrases are both caught.
export const POLISH_RULE = /po polsku|wyłącznie po polsku|tylko po polsku|polish only|only in polish|respond in polish|answer in polish|reply in polish|write in polish|speak polish|in polish only/i

export function findPolishRules(text: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = []
  text.split('\n').forEach((l, i) => {
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return // comments may talk about the old rule
    if (POLISH_RULE.test(l)) hits.push({ line: i + 1, text: t.slice(0, 120) })
  })
  return hits
}

describe('English only (the TTS is English)', () => {
  const files = [...walk(join(ROOT, 'netlify')), ...walk(join(ROOT, 'src'))]

  it('scans a real set of files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no source outside comments demands Polish output', () => {
    const bad = files.flatMap((f) => findPolishRules(readFileSync(f, 'utf8')).map((h) => `${relative(ROOT, f)}:${h.line} ${h.text}`))
    expect(bad).toEqual([])
  })

  it('the guard itself catches a Polish-only rule (and ignores comments)', () => {
    expect(findPolishRules('const R = `ANSWER i SPEECH WYŁĄCNIE PO POLSKU`').length).toBe(1)
    expect(findPolishRules('const R = "Respond in Polish, sir"').length).toBe(1)
    expect(findPolishRules('// the old rule said po polsku').length).toBe(0)
  })

  it('finance rules and the brief prompts say English', () => {
    expect(FINANCE_RULES).toContain('ENGLISH ONLY')
    expect(FINANCE_RULES).not.toMatch(POLISH_RULE)
    expect(BRIEF_SYSTEM).toMatch(/English/)
    expect(BRIEF_SYSTEM).not.toMatch(POLISH_RULE)
    expect(TRANSLATE_SYSTEM).toMatch(/into natural English/)
  })
})
