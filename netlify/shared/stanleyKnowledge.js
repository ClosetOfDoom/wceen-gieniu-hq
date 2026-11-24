// stanleyKnowledge.js — Stanley's knowledge: strategy, pillars and the day rhythm, read from stanley-wiedza/*.md.
//
// The files are shipped with the functions through `included_files` in netlify.toml (like webinar-mails/**).
// Read by the Q&A (gieniu-command: context for the model), the daily brief and the tasks endpoint ("co dziś?").
// Nothing here invents a figure: what the files call "BRAK DANYCH" stays that way.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const KNOWLEDGE_DIR = 'stanley-wiedza'

export * from './stanleyPillars.js'
import { PILLARS, parseRhythm, missingDataOf } from './stanleyPillars.js'

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
