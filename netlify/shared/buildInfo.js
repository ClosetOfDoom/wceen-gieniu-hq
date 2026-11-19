// buildInfo.js — the build hash of THIS deploy, for functions.
//
// `vite build` writes dist/version.json ({ build, time }); netlify.toml ships it with the functions (included_files),
// so a function reports the same hash as the app bundle and /version.json (P5 auto-reload compares against it).
// Fallbacks: Netlify's COMMIT_REF (first 7 chars), then 'unknown'.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function roots() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return [process.cwd(), path.resolve(here, '..', '..'), process.env.LAMBDA_TASK_ROOT].filter(Boolean)
}

/** @returns {Promise<string>} */
export async function readBuildHash() {
  for (const root of roots()) {
    try {
      const v = JSON.parse(await readFile(path.join(root, 'dist', 'version.json'), 'utf8'))
      if (typeof v.build === 'string' && v.build) return v.build
    } catch { /* next root */ }
  }
  const ref = process.env.COMMIT_REF
  return ref ? ref.slice(0, 7) : 'unknown'
}
