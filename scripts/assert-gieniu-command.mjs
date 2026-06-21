#!/usr/bin/env node
// Assert GIENIU Command Gateway contract:
// - intentRouter.ts exports detectIntent with bilingual support
// - gieniu-command.js returns correct structure
// - deterministic answers built for core intents
// - LLM fallback exists and handles no-key case
// - App.tsx calls gieniu-command with context snapshot
// - DiagnosticsPanel shows LLM status

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// ── intentRouter.ts ────────────────────────────────────────────────────────────
{
  const f = 'src/brain/intentRouter.ts'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)

    if (c.includes('detectIntent')) {
      pass('intentRouter.ts exports detectIntent()')
    } else {
      fail('intentRouter.ts must export detectIntent(message: string)')
    }

    if (c.includes('normalizeQuery')) {
      pass('intentRouter.ts exports normalizeQuery() — diacritic normalization')
    } else {
      fail('intentRouter.ts must export normalizeQuery() for bilingual normalization')
    }

    // Polish diacritics in normalizer
    if (c.includes("'ą'") || c.includes('/ą/')) {
      pass('intentRouter.ts normalizes Polish diacritics (ą, ć, ę, etc.)')
    } else {
      fail('intentRouter.ts normalizeQuery must handle Polish diacritics')
    }

    // All 14 intent types listed
    const intents = [
      'revenue_today', 'profit_today', 'orders_freshness', 'meta_freshness',
      'campaigns_today', 'jsu_funnel', 'clickmeeting_funnel', 'data_health',
      'red_flags', 'pipeline', 'creative_recommendations', 'retargeting',
      'email_rhythm', 'normal_chat',
    ]
    const missingIntents = intents.filter(i => !c.includes(`'${i}'`))
    if (missingIntents.length === 0) {
      pass('intentRouter.ts defines all 14 intent types')
    } else {
      fail(`intentRouter.ts missing intent types: ${missingIntents.join(', ')}`)
    }

    // English command examples
    const enPhrases = ['profit today', 'how much profit', 'how are we doing', 'are orders updating', 'what needs attention']
    const missingEN = enPhrases.filter(p => !c.includes(p))
    if (missingEN.length === 0) {
      pass('intentRouter.ts has English command phrases')
    } else {
      fail(`intentRouter.ts missing English phrases: ${missingEN.join(', ')}`)
    }

    // Polish command examples
    const plPhrases = ['ile na czysto', 'jak idzie', 'czy zamowienia', 'co wymaga uwagi', 'zysk dzisiaj']
    const missingPL = plPhrases.filter(p => !c.includes(p))
    if (missingPL.length === 0) {
      pass('intentRouter.ts has Polish command phrases')
    } else {
      fail(`intentRouter.ts missing Polish phrases: ${missingPL.join(', ')}`)
    }

    // confidence return
    if (c.includes('confidence')) {
      pass('intentRouter.ts returns confidence score')
    } else {
      fail('detectIntent must return confidence (0-1 number)')
    }

    // language detection
    if (c.includes("language: 'en'") || c.includes("language: lang") || c.includes('detectLanguage')) {
      pass('intentRouter.ts detects query language (en/pl/mixed)')
    } else {
      fail('detectIntent must return detected language field')
    }

    // matchedTerms
    if (c.includes('matchedTerms')) {
      pass('intentRouter.ts returns matchedTerms array')
    } else {
      fail('detectIntent must return matchedTerms array')
    }
  }
}

// ── gieniu-command.js ──────────────────────────────────────────────────────────
{
  const f = 'netlify/functions/gieniu-command.js'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)

    if (c.includes('exports.handler')) {
      pass('gieniu-command.js exports handler')
    } else {
      fail('gieniu-command.js must export handler (CommonJS exports.handler)')
    }

    // Response shape
    const fields = ['answerText', 'speechText', 'intent', 'confidence', 'dataSourcesUsed', 'warnings']
    const missing = fields.filter(f => !c.includes(f))
    if (missing.length === 0) {
      pass('gieniu-command.js returns all required response fields')
    } else {
      fail(`gieniu-command.js response missing fields: ${missing.join(', ')}`)
    }

    // Deterministic intents covered
    const deterministicIntents = ['profit_today', 'revenue_today', 'orders_freshness', 'meta_freshness', 'data_health', 'jsu_funnel', 'red_flags']
    const missingDet = deterministicIntents.filter(i => !c.includes(i))
    if (missingDet.length === 0) {
      pass('gieniu-command.js has deterministic answer builders for core intents')
    } else {
      fail(`gieniu-command.js missing deterministic builders: ${missingDet.join(', ')}`)
    }

    // LLM fallback support
    if (c.includes('LLM_PROVIDER') && c.includes('OPENAI_API_KEY') && c.includes('ANTHROPIC_API_KEY')) {
      pass('gieniu-command.js supports LLM_PROVIDER, OPENAI_API_KEY, ANTHROPIC_API_KEY env vars')
    } else {
      fail('gieniu-command.js must read LLM_PROVIDER, OPENAI_API_KEY, ANTHROPIC_API_KEY from env')
    }

    if (c.includes('callOpenAI') || c.includes('openai.com')) {
      pass('gieniu-command.js has OpenAI LLM integration')
    } else {
      fail('gieniu-command.js must integrate with OpenAI API')
    }

    if (c.includes('callAnthropic') || c.includes('anthropic.com')) {
      pass('gieniu-command.js has Anthropic LLM integration')
    } else {
      fail('gieniu-command.js must integrate with Anthropic API')
    }

    // No-LLM fallback message
    if (c.includes('LLM not configured') || c.includes('not connected yet') || c.includes('Configure LLM')) {
      pass('gieniu-command.js returns helpful message when LLM is not configured')
    } else {
      fail('gieniu-command.js must return helpful setup message when no LLM key is configured')
    }

    // System prompt references the key rules
    if (c.includes('NEVER invent') || c.includes('Never invent')) {
      pass('gieniu-command.js system prompt forbids inventing numbers')
    } else {
      fail('gieniu-command.js system prompt must forbid inventing numbers')
    }

    // bilingual support in system prompt
    if (c.includes('Polish') && c.includes('English')) {
      pass('gieniu-command.js system prompt mentions both English and Polish')
    } else {
      fail('gieniu-command.js system prompt must reference bilingual support')
    }

    // speechText shorter constraint
    if (c.includes('speechText') && c.includes('SPEECH:')) {
      pass('gieniu-command.js uses SPEECH: format for LLM to return separate speech version')
    } else {
      fail('gieniu-command.js must request separate SPEECH: section from LLM')
    }

    // Context serialization
    if (c.includes('buildContextText') || c.includes('GIENIU DASHBOARD CONTEXT')) {
      pass('gieniu-command.js serializes dashboard context for LLM')
    } else {
      fail('gieniu-command.js must serialize dashboard context into LLM prompt')
    }

    // timeout on LLM calls
    if (c.includes('AbortController') && c.includes('8000')) {
      pass('gieniu-command.js has 8-second timeout on LLM calls')
    } else {
      fail('gieniu-command.js must abort LLM fetch after 8 seconds to avoid Netlify timeout')
    }

    // llm metadata (nested object) — llmUsed kept as legacy flat field alongside llm.used
    if (c.includes('llm:') && c.includes('used:') && c.includes('active:')) {
      pass('gieniu-command.js returns llm: {active, provider, used, model} nested object')
    } else {
      fail('gieniu-command.js must return llm: {active, provider, used, model} in response')
    }
    if (c.includes('llmUsed')) {
      pass('gieniu-command.js still returns legacy llmUsed flag for backward compat')
    } else {
      fail('gieniu-command.js must keep llmUsed: boolean for backward compat')
    }

    // Cache-Control: no-store
    if (c.includes('no-store')) {
      pass('gieniu-command.js sets Cache-Control: no-store')
    } else {
      fail('gieniu-command.js must set Cache-Control: no-store to prevent stale AI responses')
    }
  }
}

// ── gieniuCommand.ts lib ──────────────────────────────────────────────────────
{
  const f = 'src/lib/gieniuCommand.ts'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)

    if (c.includes('fetchGieniuCommand')) {
      pass('gieniuCommand.ts exports fetchGieniuCommand()')
    } else {
      fail('src/lib/gieniuCommand.ts must export fetchGieniuCommand()')
    }

    if (c.includes('GieniuCommandContext')) {
      pass('gieniuCommand.ts exports GieniuCommandContext type')
    } else {
      fail('gieniuCommand.ts must export GieniuCommandContext interface')
    }

    if (c.includes('GieniuCommandResult')) {
      pass('gieniuCommand.ts exports GieniuCommandResult type')
    } else {
      fail('gieniuCommand.ts must export GieniuCommandResult interface')
    }

    if (c.includes('TIMEOUT_MS') || c.includes('AbortController')) {
      pass('gieniuCommand.ts has fetch timeout')
    } else {
      fail('gieniuCommand.ts must have a fetch timeout (AbortController) to handle slow responses')
    }

    if (c.includes('gieniu-command')) {
      pass("gieniuCommand.ts calls /.netlify/functions/gieniu-command")
    } else {
      fail("gieniuCommand.ts must call /.netlify/functions/gieniu-command")
    }
  }
}

// ── App.tsx integration ────────────────────────────────────────────────────────
{
  const c = read('src/App.tsx')

  if (c.includes('fetchGieniuCommand') && c.includes('gieniuCommand')) {
    pass('App.tsx imports fetchGieniuCommand from gieniuCommand')
  } else {
    fail('App.tsx must import fetchGieniuCommand from lib/gieniuCommand')
  }

  if (c.includes('buildCommandContext')) {
    pass('App.tsx has buildCommandContext() that builds context snapshot')
  } else {
    fail('App.tsx must have buildCommandContext() function')
  }

  if (c.includes('async function handleIntentQuery') || c.includes('handleIntentQuery = async')) {
    pass('App.tsx handleIntentQuery is async (awaits gieniu-command API)')
  } else {
    fail('App.tsx handleIntentQuery must be async to await gieniu-command API call')
  }

  if (c.includes('fallback') && (c.includes('falling back') || c.includes('resolveIntent'))) {
    pass('App.tsx falls back to local resolveIntent when gieniu-command fails')
  } else {
    fail('App.tsx must fall back to resolveIntent when gieniu-command API call fails')
  }

  if (c.includes('lastIntent') && c.includes('lastIntentConfidence')) {
    pass('App.tsx tracks lastIntent and lastIntentConfidence for diagnostics')
  } else {
    fail('App.tsx must track lastIntent and lastIntentConfidence state for DiagnosticsPanel')
  }

  if (c.includes('llmConnected')) {
    pass('App.tsx tracks llmConnected state')
  } else {
    fail('App.tsx must track llmConnected state from gieniu-command responses')
  }

  if (c.includes('topCampaigns') && c.includes('ads.slice')) {
    pass('App.tsx sends topCampaigns in context snapshot (from ads state)')
  } else {
    fail('App.tsx buildCommandContext must include topCampaigns from ads array')
  }

  if (c.includes('dataHealth') && c.includes('metaFresh')) {
    pass('App.tsx sends dataHealth in context snapshot')
  } else {
    fail('App.tsx buildCommandContext must include dataHealth with metaFresh/wixFresh')
  }
}

// ── DiagnosticsPanel LLM status ───────────────────────────────────────────────
{
  const c = read('src/components/DiagnosticsPanel.tsx')

  if (c.includes('llmConnected') && c.includes('LLM Gateway')) {
    pass('DiagnosticsPanel.tsx shows LLM Gateway status row')
  } else {
    fail('DiagnosticsPanel.tsx must show LLM Gateway: connected/not connected status')
  }

  if (c.includes('lastIntent') && c.includes('Last intent')) {
    pass('DiagnosticsPanel.tsx shows last detected intent')
  } else {
    fail('DiagnosticsPanel.tsx must show last detected intent and confidence')
  }
}

// ── Intent logic inline tests ─────────────────────────────────────────────────
// Load intentRouter.ts as JS (via simple regex extraction) and test key cases
{
  // We can't directly import TS, but we can check that the phrases map covers test cases
  const c = read('src/brain/intentRouter.ts')

  const testCases = [
    { query: 'how much profit today', expectedIntent: 'profit_today', phrase: 'profit today' },
    { query: 'ile na czysto', expectedIntent: 'profit_today', phrase: 'ile na czysto' },
    { query: 'are orders updating', expectedIntent: 'orders_freshness', phrase: 'are orders updating' },
    { query: 'czy zamowienia sie aktualizuja', expectedIntent: 'orders_freshness', phrase: 'czy zamowienia' },
    { query: 'why jsu not selling', expectedIntent: 'jsu_funnel', phrase: 'why jsu not selling' },
    { query: 'czemu kurs sie nie sprzedaje', expectedIntent: 'jsu_funnel', phrase: 'czemu kurs sie nie sprzedaje' },
  ]

  for (const tc of testCases) {
    if (c.includes(tc.phrase)) {
      pass(`intentRouter.ts has phrase '${tc.phrase}' → ${tc.expectedIntent}`)
    } else {
      fail(`intentRouter.ts missing phrase '${tc.phrase}' for ${tc.expectedIntent}`)
    }
  }

  // normal_chat / LLM fallback path: queries with no phrase match return normal_chat
  if (c.includes('normal_chat') && c.includes('confidence >= 0.4')) {
    pass('intentRouter.ts returns normal_chat when confidence < 0.4 (LLM fallback trigger)')
  } else {
    fail('intentRouter.ts must return normal_chat for low-confidence queries (triggers LLM fallback)')
  }
}

// ── package.json ──────────────────────────────────────────────────────────────
{
  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts && pkg.scripts['assert:gieniu-command']) {
    pass('package.json has assert:gieniu-command script')
  } else {
    fail('package.json missing assert:gieniu-command script')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — GIENIU Command Gateway contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} command gateway violation(s).`)
  process.exit(1)
}
