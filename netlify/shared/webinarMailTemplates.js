// webinarMailTemplates.js — reads the HTML templates of a slot from webinar-mails/<slot>/*.html.
// In a deployed function the files are shipped through `included_files` in netlify.toml.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function roots() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [process.cwd(), path.resolve(here, '..', '..'), process.env.LAMBDA_TASK_ROOT].filter(Boolean)
}

/** [{ file, html }] sorted by file name; throws when the folder cannot be found anywhere. */
export async function loadTemplates(dir) {
  let lastError = null
  for (const root of roots()) {
    const full = path.join(root, dir)
    try {
      const names = (await readdir(full)).filter((n) => n.toLowerCase().endsWith('.html')).sort()
      return await Promise.all(names.map(async (file) => ({ file, html: await readFile(path.join(full, file), 'utf8') })))
    } catch (e) {
      lastError = e
    }
  }
  throw new Error(`Nie znaleziono folderu szablonów ${dir}: ${lastError?.code ?? lastError?.message}`)
}
