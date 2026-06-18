#!/usr/bin/env node
// Assert TTS architecture rules:
// - Frontend only calls /.netlify/functions/gieniu-tts (no direct eleven-tts or ElevenLabs URLs)
// - No browser speechSynthesis fallback in prod code
// - gieniu-tts.js exists and re-exports or routes to eleven-tts

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. gieniu-tts.js must exist
const gieniuTtsPath = join(rootDir, 'netlify/functions/gieniu-tts.js')
if (!existsSync(gieniuTtsPath)) {
  fail('netlify/functions/gieniu-tts.js does not exist')
} else {
  const c = readFileSync(gieniuTtsPath, 'utf8')
  if (c.includes('eleven-tts') || c.includes('elevenTtsHandler') || c.includes('export { handler }')) {
    pass('gieniu-tts.js references eleven-tts (delegation pattern OK)')
  } else {
    fail('gieniu-tts.js does not reference eleven-tts — provider routing may be broken')
  }
}

// 2. tts.ts must call gieniu-tts, not eleven-tts directly
const ttsTsPath = join(rootDir, 'src/voice/tts.ts')
if (!existsSync(ttsTsPath)) {
  fail('src/voice/tts.ts does not exist')
} else {
  const c = readFileSync(ttsTsPath, 'utf8')
  if (c.includes('gieniu-tts')) {
    pass('tts.ts calls gieniu-tts endpoint')
  } else {
    fail('tts.ts does not call gieniu-tts — frontend TTS endpoint is wrong')
  }
  if (c.includes('eleven-tts') && !c.includes('gieniu-tts')) {
    fail('tts.ts still calls eleven-tts directly — should call gieniu-tts instead')
  }
}

// 3. No speechSynthesis fallback in tts.ts (allow in stop cleanup, flag in speak path)
if (existsSync(ttsTsPath)) {
  const c = readFileSync(ttsTsPath, 'utf8')
  const speakFn = c.slice(c.indexOf('export async function speak('))
  if (/speechSynthesis\.(speak|getVoices|cancel)\(/i.test(speakFn)) {
    fail('tts.ts speak() uses browser speechSynthesis — forbidden')
  } else {
    pass('tts.ts speak() has no browser speechSynthesis fallback')
  }
}

// 4. eleven-tts.js must still exist (it is the actual provider implementation)
const elevenTtsPath = join(rootDir, 'netlify/functions/eleven-tts.js')
if (!existsSync(elevenTtsPath)) {
  fail('netlify/functions/eleven-tts.js missing — voice provider implementation gone')
} else {
  pass('eleven-tts.js exists (backend provider)')
}

// 5. tools/local-tts-server scaffold must exist
const localTtsReadme = join(rootDir, 'tools/local-tts-server/README.md')
if (!existsSync(localTtsReadme)) {
  fail('tools/local-tts-server/README.md missing — local fallback scaffold not present')
} else {
  pass('tools/local-tts-server scaffold exists')
}

console.log()
if (errors === 0) {
  console.log('PASS — TTS architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} TTS architecture violation(s).`)
  process.exit(1)
}
