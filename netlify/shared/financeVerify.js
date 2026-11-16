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
  return sectionsToText(sectionsFrom(text))
}

/** The comment as data: [{ id, title, items }] — items without bullets, hypotheses / ideas labelled. Sections the model left out are absent. */
export function sectionsFrom(text) {
  const buckets = new Map(SECTIONS.map((s) => [s, []]))
  let current = 'WNIOSKI'
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const h = headerOf(line)
    if (h) { current = h; continue }
    buckets.get(current).push(line.replace(/^[-•*]\s+/, '').replace(/^\d+[.)]\s+/, ''))
  }
  return SECTIONS.filter((s) => buckets.get(s).length > 0).map((id) => ({
    id,
    title: id,
    items: buckets.get(id).map((l) => {
      if (id === 'DLACZEGO') return /^(\*\*)?hipotez/i.test(l) ? l : `Hipoteza: ${l}`
      if (id === 'POMYSŁY') return /^(\*\*)?propozycj/i.test(l) ? l : `Propozycja: ${l}`
      return l
    }),
  }))
}

export function sectionsToText(sections) {
  return sections.map((s) => [s.title, ...s.items.map((i) => `- ${i}`)].join('\n')).join('\n\n')
}

// ── comment rules (usefulness, small sample, length) ─────────────────────────────────────────

/** Fillers that say nothing a person could act on. A sentence with one of them is removed. */
export const GENERIC_RE = /monitor(?:ow|uj|ing)\w*|rozwa[żz]\w*\s+(?:dzia[łl]ani\w*|kampani\w*|zmian\w*)|dzia[łl]ani\w*\s+marketingow\w*|warto\s+(?:przeanalizowa\w*|rozwa[żz]\w*|zbada\w*|przyjrze\w*|obserwowa\w*)|nale[żz]y\s+(?:przeanalizowa\w*|zbada\w*|obserwowa\w*)|dalsz\w+\s+analiz\w*|zbada\w*\s+przyczyn\w*|optymalizowa\w*\s+(?:kampani\w*|dzia[łl]ani\w*)/i

/** Words that turn a statement about a small sample into a claim about a trend / change. */
export const TREND_RE = /trend|wzrost|wzrosł|wzros|spadek|spadł|spada|zmniejsz|zwiększ|zmian[aęyie]|dynamik|pogorszeni|poprawi|\bvs\b|względem|→|[-+−]\s?\d[\d\s]*[,.]?\d*\s*%|\bo\s+\d[\d\s]*[,.]?\d*\s*%/i

const splitSentences = (text) => String(text ?? '').split(SENTENCE_SPLIT)

function mapItems(sections, fn) {
  return sections
    .map((s) => ({ ...s, items: s.items.map(fn).filter((i) => i !== null && i !== '') }))
    .filter((s) => s.items.length > 0)
}

/** Removes sentences made of fillers ("monitorować", "warto przeanalizować", "rozważyć działania marketingowe"…). */
export function dropGeneric(sections) {
  let dropped = 0
  const out = mapItems(sections, (item) => {
    const kept = splitSentences(item).filter((s) => {
      if (!GENERIC_RE.test(s)) return true
      dropped++
      return false
    })
    return kept.length > 0 ? kept.join(' ') : null
  })
  return { sections: out, dropped }
}

/**
 * Small-sample rule. For every topic with fewer than 5 events in either compared period (or an unknown count) a sentence that talks
 * about a trend or a change of that topic is replaced — once — by "<Temat>: zbyt mało zdarzeń (n) — bez trendu i bez zmiany procentowej".
 * @param rules [{ id: 'zwroty' | 'płatności', pattern: RegExp, n: string | null }]
 */
export function applySmallSample(sections, rules) {
  let replaced = 0
  const said = new Set()
  const out = mapItems(sections, (item) => {
    const parts = []
    for (const s of splitSentences(item)) {
      const rule = rules.find((r) => r.pattern.test(s) && TREND_RE.test(s))
      if (!rule) { parts.push(s); continue }
      replaced++
      if (said.has(rule.id)) continue
      said.add(rule.id)
      const label = rule.id.charAt(0).toUpperCase() + rule.id.slice(1)
      parts.push(`${label}: zbyt mało zdarzeń (${rule.n ?? `liczba ${rule.gen ?? rule.id} nieznana — brak w pliku`}) — bez trendu i bez zmiany procentowej.`)
    }
    return parts.length > 0 ? parts.join(' ') : null
  })
  return { sections: out, replaced }
}

/** Every hypothesis must say what to check (Sprawdź), where, and which result confirms (Potwierdzi) and which refutes it (Obali). */
export function checkHypotheses(sections) {
  let dropped = 0
  const out = sections
    .map((s) => (s.id !== 'DLACZEGO' ? s : {
      ...s,
      items: s.items.filter((i) => {
        const ok = /sprawd[źz]/i.test(i) && /potwierdz/i.test(i) && /obal/i.test(i)
        if (!ok) dropped++
        return ok
      }),
    }))
    .filter((s) => s.items.length > 0)
  return { sections: out, dropped }
}

export const MAX_COMMENT_WORDS = 150
const words = (text) => stripWords(text).split(/\s+/).filter(Boolean).length
const stripWords = (t) => String(t ?? '').replace(/\*\*/g, '')

/** At most `max` words in all items: trailing ideas go first, then hypotheses, then actions; the first conclusion is never cut. */
export function limitWords(sections, max = MAX_COMMENT_WORDS) {
  let trimmed = 0
  const work = sections.map((s) => ({ ...s, items: [...s.items] }))
  const count = () => work.reduce((n, s) => n + s.items.reduce((m, i) => m + words(i), 0), 0)
  for (const id of ['POMYSŁY', 'DLACZEGO', 'CO SPRAWDZIĆ LUB ZROBIĆ', 'WNIOSKI']) {
    const s = work.find((x) => x.id === id)
    while (s && count() > max && s.items.length > (id === 'WNIOSKI' ? 1 : 0)) {
      s.items.pop()
      trimmed++
    }
  }
  return { sections: work.filter((s) => s.items.length > 0), trimmed }
}

/**
 * One or two sentences of the conclusion for speech. Only the FIRST item of WNIOSKI is used (it is the conclusion); a sentence with more than
 * two figures is shortened at the first clause boundary (" (", " — ", ", ", "; ") so that no list of figures is read out; markup removed.
 */
export function speechFrom(sections, maxChars = 260) {
  const first = sections.find((s) => s.id === 'WNIOSKI')?.items[0]
  if (!first) return ''
  const shorten = (sentence) => {
    let t = sentence.trim()
    while (extractNumbers(t).length > 2) {
      const cut = Math.max(t.lastIndexOf(' ('), t.lastIndexOf(' — '), t.lastIndexOf(', '), t.lastIndexOf('; '))
      if (cut <= 0) return ''
      t = t.slice(0, cut).trim()
    }
    return /[.!?…]$/.test(t) ? t : `${t}.`
  }
  const picked = splitSentences(stripWords(first)).map(shorten).filter(Boolean).slice(0, 2)
  let text = picked.join(' ')
  if (text.length > maxChars) text = picked[0] ?? ''
  return text.length > maxChars ? text.slice(0, maxChars - 1).replace(/s+S*$/, '') + '…' : text
}

/** Small-sample rules from the merged view: refunds (count unknown or < 5) and payments (< 5) in any comparison. */
export function smallSampleRules(view) {
  const rules = []
  const comps = (view?.months ?? []).filter((m) => m.available).flatMap((m) =>
    ['stripe', 'p24', 'paypal'].map((k) => m.sources?.[k]?.changeVsPrevious).filter((c) => c?.comparable && c.sample))
  const refunds = comps.find((c) => c.sample.refunds?.small)
  if (refunds) rules.push({ id: 'zwroty', gen: 'zwrotów', pattern: /zwrot/i, n: refunds.sample.refunds.n ?? null })
  const payments = comps.find((c) => c.sample.payments?.small)
  if (payments) rules.push({ id: 'płatności', gen: 'płatności', pattern: /płatno/i, n: payments.sample.payments.n })
  return rules
}

/**
 * The whole comment pipeline: scrub → sections → fillers → numbers → small sample → hypotheses → length.
 * @returns {{ sections, counts: { checked, removed, scrubbed, generic, smallSample, hypotheses, trimmed } }}
 */
export function refineSections(raw, allowed, { smallSample = [] } = {}) {
  const scrubbed = scrubModelText(raw)
  let sections = sectionsFrom(scrubbed.text)
  const generic = dropGeneric(sections)
  sections = generic.sections
  let checked = 0
  let removed = 0
  sections = mapItems(sections, (item) => {
    const v = verifyNumbers(item, allowed)
    checked += v.checked
    removed += v.removed
    return v.text
  })
  const small = applySmallSample(sections, smallSample)
  const hyp = checkHypotheses(small.sections)
  const lim = limitWords(hyp.sections)
  return {
    sections: lim.sections,
    counts: { checked, removed, scrubbed: scrubbed.secrets + scrubbed.tax, generic: generic.dropped, smallSample: small.replaced, hypotheses: hyp.dropped, trimmed: lim.trimmed },
  }
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
