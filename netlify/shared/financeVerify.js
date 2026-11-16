// financeVerify.js — server-side control of the model's finance comment. Pure functions, no I/O.
//
//  1. verifyNumbers   every number in the comment (amounts, percentages, counts) must come from the data the tool
//                     returned (the rendered report and the raw view) or be a simple operation on two of those numbers
//                     (difference, percentage). A sentence with a number outside the data is removed; only the FACT
//                     (counts) is returned for logging — never the sentence or the number.
//  2. normalizeSections  WNIOSKI / DLACZEGO (hypotheses) / CO SPRAWDZIĆ LUB ZROBIĆ / POMYSŁY (proposals), labelled by the server.
//  3. scrubModelText  sentences that touch secrets / system prompt, and tax determinations (ZUS, PIT-4, VAT), are dropped.
//
// Zero numbers from the model's memory: when in doubt the sentence goes.

const NBSP = '  '
// 1 234,56 | 1234,56 | 12,5 | 12.5 | 138   (thousands separated by a space / NBSP)
const NUMBER = new RegExp(`(?<![\\w.,])[-+−]?(?:\\d{1,3}(?:[ ${NBSP}]\\d{3})+|\\d+)(?:[.,]\\d+)?(?![\\w])`, 'g')
const DATE_LIKE = /\b\d{4}-\d{2}(?:-\d{2})?\b|\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/g
const SMALL_COUNT_UNIT = /^\s*(miesi|źród|zrod|krok|dni\b|dzie[nń]|tygod|tydzie)/i

export const SECTIONS = ['WNIOSKI', 'DLACZEGO', 'CO SPRAWDZIĆ LUB ZROBIĆ', 'POMYSŁY']

/** Numeric tokens of a text as [{ value, decimals, index, text }]; dates and month labels (2026-10) are not numbers here. */
export function extractNumbers(text) {
  const clean = String(text ?? '').replace(DATE_LIKE, (m) => ' '.repeat(m.length))
  const out = []
  for (const m of clean.matchAll(NUMBER)) {
    const raw = m[0]
    const body = raw.replace(/^[-+−]/, '').replace(new RegExp(`[ ${NBSP}]`, 'g'), '')
    const norm = body.replace(',', '.')
    const value = Number(norm) * (/^[-−]/.test(raw) ? -1 : 1)
    if (!Number.isFinite(value)) continue
    const decimals = norm.includes('.') ? norm.split('.')[1].length : 0
    out.push({ value, decimals, index: m.index, text: raw, after: clean.slice(m.index + raw.length, m.index + raw.length + 24) })
  }
  return out
}

function collectJsonNumbers(value, out, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return
  if (typeof value === 'number' && Number.isFinite(value)) out.push(value)
  else if (Array.isArray(value)) for (const v of value) collectJsonNumbers(v, out, depth + 1)
  else if (typeof value === 'object') for (const v of Object.values(value)) collectJsonNumbers(v, out, depth + 1)
}

/** Sorted unique values the comment may quote: numbers of the rendered report plus raw numbers of the view (grosze and zł). */
export function buildAllowed({ reportText = '', data = [] } = {}) {
  const set = new Set()
  const add = (v) => set.add(Math.round(v * 1e6) / 1e6)
  for (const n of extractNumbers(reportText)) add(Math.abs(n.value))
  const raw = []
  collectJsonNumbers(data, raw)
  for (const v of raw) {
    const a = Math.abs(v)
    add(a)
    add(a / 100) // amounts are in grosze in the data, in zł in the report
  }
  return [...set].sort((a, b) => a - b)
}

function hasNear(sorted, x, tol) {
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < x - tol) lo = mid + 1
    else if (sorted[mid] > x + tol) hi = mid - 1
    else return true
  }
  return false
}

/**
 * Is |v| (quoted at `decimals` places) in the data, or a simple operation on two numbers of the SAME sentence that are themselves in the data?
 * Operations: difference |a − b|, percentage a / b · 100, change (a − b) / b · 100. Operands must stand in the sentence: otherwise, with hundreds
 * of numbers in the data, nearly any percentage would match some pair by chance.
 */
export function isDerivable(v, decimals, sorted, operands = []) {
  const x = Math.abs(v)
  const tol = 0.5 * 10 ** -decimals + 1e-9
  if (hasNear(sorted, x, tol)) return true
  for (const a of operands) {
    for (const b of operands) {
      if (a === b && operands.indexOf(a) === operands.lastIndexOf(a)) continue
      if (Math.abs(Math.abs(a - b) - x) <= tol) return true // difference
      if (b !== 0 && Math.abs((a / b) * 100 - x) <= tol) return true // a is x % of b
      if (b !== 0 && Math.abs(((a - b) / b) * 100 - x) <= tol) return true // change of a against b
      if (b !== 0 && Math.abs(((b - a) / b) * 100 - x) <= tol) return true // decrease
    }
  }
  return false
}

const isYear = (n) => n.decimals === 0 && n.value >= 2000 && n.value <= 2099

function numbersOk(sentence, sorted) {
  const nums = extractNumbers(sentence).filter((n) => !isYear(n))
  const operands = nums.filter((n) => hasNear(sorted, Math.abs(n.value), 0.5 * 10 ** -n.decimals + 1e-9)).map((n) => Math.abs(n.value))
  let bad = 0
  for (const n of nums) {
    if (n.decimals === 0 && n.value >= 1 && n.value <= 6 && SMALL_COUNT_UNIT.test(n.after)) continue // „2 miesiące”, „3 źródła”
    if (!isDerivable(n.value, n.decimals, sorted, operands)) bad++
  }
  return bad
}

const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ"„(])/

/**
 * Removes every sentence that holds a number outside the data. Header lines are left alone.
 * @returns {{ text:string, checked:number, removed:number }} counts only — for the log
 */
export function verifyNumbers(text, allowed) {
  let checked = 0
  let removed = 0
  const lines = String(text ?? '').split('\n').map((line) => {
    if (isHeader(line)) return line
    const lead = line.match(/^\s*(?:[-•*]\s+|\d+[.)]\s+)?/)?.[0] ?? ''
    const body = line.slice(lead.length)
    const kept = body.split(SENTENCE_SPLIT).filter((s) => {
      const hasNumber = extractNumbers(s).length > 0
      if (!hasNumber) return true
      checked++
      if (numbersOk(s, allowed) === 0) return true
      removed++
      return false
    })
    return kept.length === 0 ? null : lead + kept.join(' ')
  }).filter((l) => l !== null)
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), checked, removed }
}

// ── sections ─────────────────────────────────────────────────────────────────────────────────

const HEADER_RE = /^[\s#*_>-]*(WNIOSKI|DLACZEGO|CO SPRAWDZI[ĆC] LUB ZROBI[ĆC]|POMYS[ŁL]Y)[\s*_:)(a-ząćęłńóśźż-]*$/i

function headerOf(line) {
  const m = line.match(HEADER_RE)
  if (!m) return null
  const k = m[1].toUpperCase().replace('ZROBIC', 'ZROBIĆ').replace('SPRAWDZIC', 'SPRAWDZIĆ').replace('POMYSLY', 'POMYSŁY')
  return SECTIONS.find((s) => s === k) ?? null
}
const isHeader = (line) => headerOf(line.trim()) !== null

/**
 * Splits the comment into the four sections and labels them: hypotheses start with "Hipoteza:", ideas with "Propozycja:",
 * actions are bullets. Text before the first header goes under WNIOSKI. Sections the model left out are omitted.
 */
export function normalizeSections(text) {
  const buckets = new Map(SECTIONS.map((s) => [s, []]))
  let current = 'WNIOSKI'
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const h = headerOf(line)
    if (h) { current = h; continue }
    buckets.get(current).push(line.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, ''))
  }
  const out = []
  for (const s of SECTIONS) {
    const lines = buckets.get(s)
    if (lines.length === 0) continue
    out.push(s)
    for (const l of lines) {
      if (s === 'DLACZEGO') out.push(/^hipotez/i.test(l) ? `- ${l}` : `- Hipoteza: ${l}`)
      else if (s === 'POMYSŁY') out.push(/^propozycj/i.test(l) ? `- ${l}` : `- Propozycja: ${l}`)
      else out.push(`- ${l}`)
    }
    out.push('')
  }
  return out.join('\n').trim()
}

// ── scrubs ───────────────────────────────────────────────────────────────────────────────────

const SECRET_RE = /sk-[\w-]{8,}|eyJ[\w-]{16,}|service[\s_-]?role|api[\s_-]?key|klucz(?:a|e|y|em)?\s+(?:api|serwisow|dostępu|dostepu)|x-stanley-token|\b(?:ANTHROPIC|OPENAI|SUPABASE|STANLEY|ELEVEN|STRIPE|PAYPAL|META)_[A-Z_]+\b|system(?:owy|owe|owego)?\s+prompt|prompt\s+system|instrukcj\w*\s+system|wartość zmiennej|zmienn\w+ środowisk/i
const TAX_RE = /\b(zus|pit-?4?|vat)\b/i

function dropSentences(text, re) {
  let removed = 0
  const lines = String(text ?? '').split('\n').map((line) => {
    if (isHeader(line)) return line
    const lead = line.match(/^\s*(?:[-•*]\s+|\d+[.)]\s+)?/)?.[0] ?? ''
    const kept = line.slice(lead.length).split(SENTENCE_SPLIT).filter((s) => {
      if (!re.test(s)) return true
      removed++
      return false
    })
    return kept.length === 0 ? null : lead + kept.join(' ')
  }).filter((l) => l !== null)
  return { text: lines.join('\n').trim(), removed }
}

/** Secrets / system prompt and tax determinations out of the model's text; counts only. */
export function scrubModelText(text) {
  const a = dropSentences(text, SECRET_RE)
  const b = dropSentences(a.text, TAX_RE)
  return { text: b.text, secrets: a.removed, tax: b.removed }
}

/** Question text is data: it cannot close the tag that wraps it. */
export function wrapQuestion(message) {
  const safe = String(message ?? '').replace(/<\/?\s*pytanie_uzytkownika\s*>/gi, ' ').slice(0, 1200)
  return `<pytanie_uzytkownika>\n${safe}\n</pytanie_uzytkownika>`
}
