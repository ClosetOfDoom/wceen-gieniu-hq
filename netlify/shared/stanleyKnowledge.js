// stanleyKnowledge.js — Stanley's knowledge: strategy, pillars and the day rhythm, read from stanley-wiedza/*.md.
//
// The files are shipped with the functions through `included_files` in netlify.toml (like webinar-mails/**).
// Read by the Q&A (gieniu-command: context for the model), the daily brief and the tasks endpoint ("co dziś?").
// Nothing here invents a figure: what the files call "BRAK DANYCH" stays that way.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const KNOWLEDGE_DIR = 'stanley-wiedza'

/** Strategic monthly revenue goal (PLN): a PROGRESS goal, never an alarm threshold. */
export const STRATEGIC_MONTHLY_GOAL = 100000

/** The six pillars (slug = file name in stanley-wiedza/filary/). */
export const PILLARS = Object.freeze([
  Object.freeze({ slug: 'stowarzyszenie', name: 'Stowarzyszenie' }),
  Object.freeze({ slug: '101-drinkow', name: 'Książka „101 drinków”' }),
  Object.freeze({ slug: 'jezyki', name: 'Języki' }),
  Object.freeze({ slug: 'szanty', name: '„Szanty i szantymeni”, nowa edycja' }),
  Object.freeze({ slug: 'google-ad-grants', name: 'Google Ad Grants' }),
  Object.freeze({ slug: 'wsztp', name: 'Wakacyjna szkoła mnemotechniki (WSZTP)' }),
])

/**
 * Products of netlify/shared/productCatalog.js with a CERTAIN pillar. Every other product is "nieprzypisane".
 * Mirrors the table in stanley-wiedza/strategia.md (a test keeps both equal).
 */
export const PRODUCT_PILLARS = Object.freeze({
  language_3t: 'jezyki',
  jezykozak_pack: 'jezyki',
  jzk_ai: 'jezyki',
  lang_3t_single: 'jezyki',
  lang_3t_pdf: 'jezyki',
  wsztp: 'wsztp',
})

export function pillarOfProduct(productKey) {
  return PRODUCT_PILLARS[productKey] ?? 'nieprzypisane'
}

/** Keywords that tie a free-text task to a pillar (first match wins). Normalised text (no Polish diacritics). */
const PILLAR_KEYWORDS = [
  ['stowarzyszenie', /stowarzysz|skladk|czlonk|szczesliw\w* pici/],
  ['101-drinkow', /101 drink|drink|\brum\b|rumu|rumem/],
  ['szanty', /szant/],
  ['google-ad-grants', /grant|google ads|ad grants|google/],
  ['wsztp', /wsztp|mnemotechni|wakacyjn\w* szkol/],
  ['jezyki', /jezyk|jzk|3t\b/],
]

export function normalizePl(text) {
  return String(text ?? '').toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
}

/** Pillar slug guessed from free text, or null. */
export function pillarFromText(text) {
  const t = normalizePl(text)
  for (const [slug, re] of PILLAR_KEYWORDS) if (re.test(t)) return slug
  return null
}

// ── day rhythm ─────────────────────────────────────────────────────────────────

const DAY_WORDS = { nd: 0, niedz: 0, pon: 1, pn: 1, wt: 2, sr: 3, śr: 3, czw: 4, pt: 5, sob: 6 }

function parseDays(spec) {
  const s = String(spec ?? '').trim().toLowerCase()
  if (s === 'codziennie') return [0, 1, 2, 3, 4, 5, 6]
  if (s === 'pn-pt' || s === 'pon-pt') return [1, 2, 3, 4, 5]
  const out = []
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const d = DAY_WORDS[part] ?? DAY_WORDS[normalizePl(part)]
    if (d === undefined) throw new Error(`rytm dnia: nieznany dzień „${part}”`)
    out.push(d)
  }
  return out
}

/**
 * Lines "- HH:MM[–HH:MM] | dni | opis" of rytm-dnia.md → [{ id, start, end, days, title, pillar }] sorted by start.
 * A line "Filar dnia: <nazwa>" carries the pillar of that day (pillar = slug guessed from the name, or null).
 */
export function parseRhythm(md) {
  const out = []
  for (const raw of String(md ?? '').split(/\r?\n/)) {
    const m = raw.match(/^\s*-\s*(\d{2}:\d{2})(?:\s*[–-]\s*(\d{2}:\d{2}))?\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/)
    if (!m) continue
    const [, start, end, daySpec, title] = m
    const isPillar = /^filar dnia:/i.test(title)
    out.push({
      id: `rytm-${start.replace(':', '')}-${normalizePl(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`,
      start, end: end ?? null, days: parseDays(daySpec), title,
      pillarOfDay: isPillar ? title.replace(/^filar dnia:\s*/i, '') : null,
    })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

/** Rhythm entries of one weekday (0 = Sunday). */
export function rhythmFor(weekday, rhythm) {
  return rhythm.filter((e) => e.days.includes(weekday))
}

/** "Filar dnia" of a weekday, or null (weekend). */
export function pillarOfDay(weekday, rhythm) {
  return rhythmFor(weekday, rhythm).find((e) => e.pillarOfDay)?.pillarOfDay ?? null
}

// ── pillars: missing data ──────────────────────────────────────────────────────

/** Bullets of the "## Brakujące dane" section of a pillar file. */
export function missingDataOf(md) {
  const lines = String(md ?? '').split(/\r?\n/)
  const i = lines.findIndex((l) => /^##\s+Brakuj/i.test(l))
  if (i < 0) return []
  const out = []
  for (const l of lines.slice(i + 1)) {
    if (/^##\s/.test(l)) break
    const m = l.match(/^\s*-\s+(.+)$/)
    if (m) out.push(m[1].trim())
  }
  return out
}

/** At most `n` questions for the day, rotating through the whole list by the day number (stable for one date). */
export function questionsForDay(questions, date, n = 2) {
  if (!questions.length) return []
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400e3)
  const start = ((day * n) % questions.length + questions.length) % questions.length
  const out = []
  for (let i = 0; i < Math.min(n, questions.length); i++) out.push(questions[(start + i) % questions.length])
  return out
}

// ── loading ────────────────────────────────────────────────────────────────────

function roots() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [process.cwd(), path.resolve(here, '..', '..'), process.env.LAMBDA_TASK_ROOT].filter(Boolean)
}

/** Every knowledge file: { strategia, rytm, rhythm, pillars: [{ slug, name, text, missing }] }. Throws when the folder is not found. */
export async function loadKnowledge() {
  let lastError = null
  for (const root of roots()) {
    const dir = path.join(root, KNOWLEDGE_DIR)
    try {
      const [strategia, rytm] = await Promise.all([readFile(path.join(dir, 'strategia.md'), 'utf8'), readFile(path.join(dir, 'rytm-dnia.md'), 'utf8')])
      const files = new Set(await readdir(path.join(dir, 'filary')))
      const pillars = await Promise.all(PILLARS.map(async (p) => {
        const text = files.has(`${p.slug}.md`) ? await readFile(path.join(dir, 'filary', `${p.slug}.md`), 'utf8') : ''
        return { ...p, text, missing: missingDataOf(text) }
      }))
      return { strategia, rytm, rhythm: parseRhythm(rytm), pillars }
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(`Nie znaleziono folderu ${KNOWLEDGE_DIR}: ${lastError?.code ?? lastError?.message}`)
}

/** Every missing-data question of every pillar, prefixed with the pillar name. */
export function allMissingQuestions(knowledge) {
  return knowledge.pillars.flatMap((p) => p.missing.map((q) => `${p.name}: ${q}`))
}

/** Text block for the Q&A model: the strategy, the pillars (without the long descriptions) and the day rhythm. */
export function knowledgeContext(knowledge) {
  const pillars = knowledge.pillars.map((p) => `### ${p.name} (${p.slug})\n${p.text.replace(/^#.*\n/, '').trim()}`).join('\n\n')
  return `=== WIEDZA STANLEYA (stanley-wiedza/, od Filipa; „BRAK DANYCH” znaczy: nie wiemy, nie zgaduj) ===\n${knowledge.strategia.trim()}\n\n${pillars}\n\n${knowledge.rytm.trim()}`
}
