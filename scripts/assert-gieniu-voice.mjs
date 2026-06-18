#!/usr/bin/env node
// Build-time assertion: George (JBFqnCBsd6RMkjVDRZzb) is the only ElevenLabs voice in the codebase.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname } from 'path'

const ALLOWED_VOICE_ID   = 'JBFqnCBsd6RMkjVDRZzb'
const ALLOWED_VOICE_NAME = 'George'

const BAD_PATTERNS = [
  // Specific known-bad ElevenLabs voice IDs (as quoted strings or bare constants)
  { label: 'Daniel ElevenLabs voice ID', re: /onwK4e9ZLuTAKqWW03F9/g },
  // Voice names used as ElevenLabs voice selection (not just any mention of the name)
  { label: 'voice name Rachel in voice context', re: /Rachel.*voice|voice.*Rachel|voiceName.*Rachel|Rachel.*voiceName/gi },
  { label: 'voice name Bella in voice context',  re: /Bella.*voice|voice.*Bella|voiceName.*Bella|Bella.*voiceName/gi },
  // "female" in voice-selection context
  { label: 'female voice selection',  re: /['"](female)['"]/gi },
  // Any quoted 20-char alphanumeric string that is NOT George's ID
  // (ElevenLabs voice IDs are exactly 20 chars)
  {
    label: 'unknown quoted ElevenLabs voice ID',
    re: /['"][A-Za-z0-9]{20}['"]/g,
    filterFn: (match) => {
      const inner = match.slice(1, -1)
      return inner !== ALLOWED_VOICE_ID
    },
  },
]

const SCAN_DIRS = ['src', 'netlify/functions']
const SCAN_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])
const IGNORE_FILES = ['assert-gieniu-voice.mjs']

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let totalErrors = 0
let scannedFiles = 0

function scanDir(dir) {
  const full = join(rootDir, dir)
  if (!existsSync(full)) return
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const entryPath = join(full, entry)
    const rel = join(dir, entry)
    const st = statSync(entryPath)
    if (st.isDirectory()) { scanDir(rel); continue }
    if (!SCAN_EXTS.has(extname(entry).toLowerCase())) continue
    if (IGNORE_FILES.some(ig => entry === ig)) continue

    const content = readFileSync(entryPath, 'utf8')
    scannedFiles++

    for (const { label, re, filterFn } of BAD_PATTERNS) {
      const regex = new RegExp(re.source, re.flags)
      let match
      while ((match = regex.exec(content)) !== null) {
        const hit = match[0]
        if (filterFn && !filterFn(hit)) continue
        const lineNum = content.slice(0, match.index).split('\n').length
        const line = content.split('\n')[lineNum - 1].trim()
        if (line.startsWith('//') || line.startsWith('*')) continue  // skip comments
        console.error(`  FAIL [${label}]`)
        console.error(`       in ${rel}:${lineNum}`)
        console.error(`       → "${line.slice(0, 100)}"`)
        totalErrors++
      }
    }
  }
}

console.log('GIENIU voice assertion')
console.log(`  Allowed: ${ALLOWED_VOICE_NAME} (${ALLOWED_VOICE_ID})`)
console.log()

for (const dir of SCAN_DIRS) scanDir(dir)

console.log(`Scanned ${scannedFiles} files.`)
console.log()

if (totalErrors === 0) {
  console.log(`PASS — George (${ALLOWED_VOICE_ID}) is the only voice. No bad voices found.`)
  process.exit(0)
} else {
  console.error(`FAIL — ${totalErrors} bad voice reference(s) found. Fix before deploying.`)
  process.exit(1)
}
