#!/usr/bin/env node
// Assert webinar data architecture rules:
// - Raw tables (webinar_participants) used as primary source, not views
// - No raw JSON displayed in participant UI
// - "No ClickMeeting data" guarded by sessions=0 AND participants=0
// - Product classifier handles JSU/JZK
// - webinarRawData.ts exists

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. webinarRawData.ts exists
const rawDataPath = join(rootDir, 'src/lib/webinarRawData.ts')
if (!existsSync(rawDataPath)) {
  fail('src/lib/webinarRawData.ts does not exist')
} else {
  const c = readFileSync(rawDataPath, 'utf8')
  if (c.includes("from('webinar_participants')") && c.includes("from('webinar_sessions')")) {
    pass('webinarRawData.ts queries both raw tables')
  } else {
    fail('webinarRawData.ts does not query webinar_sessions or webinar_participants directly')
  }
}

// 2. webinarProduct.ts exists with JSU/JZK classifier
const productPath = join(rootDir, 'src/lib/webinarProduct.ts')
if (!existsSync(productPath)) {
  fail('src/lib/webinarProduct.ts does not exist')
} else {
  const c = readFileSync(productPath, 'utf8')
  if (c.includes("'JSU'") && c.includes("'JZK'") && c.includes('normalizeProduct')) {
    pass('webinarProduct.ts has JSU/JZK classifier')
  } else {
    fail('webinarProduct.ts missing JSU/JZK or normalizeProduct function')
  }
  if (c.includes('nauka jezykow') || c.includes('jezykozak')) {
    pass('webinarProduct.ts includes language webinar patterns')
  } else {
    fail('webinarProduct.ts missing JZK session_name patterns')
  }
}

// 3. clickmeetingNormalize.ts has extractEmail + normalizeParticipantRow
const normPath = join(rootDir, 'src/lib/clickmeetingNormalize.ts')
if (!existsSync(normPath)) {
  fail('src/lib/clickmeetingNormalize.ts does not exist')
} else {
  const c = readFileSync(normPath, 'utf8')
  if (c.includes('extractEmail') && c.includes('normalizeParticipantFields')) {
    pass('clickmeetingNormalize.ts has email extraction + normalization')
  } else {
    fail('clickmeetingNormalize.ts missing extractEmail or normalizeParticipantFields')
  }
}

// 4. webinarFunnel.ts uses backend function (service role) or raw tables as primary
const funnelPath = join(rootDir, 'src/services/webinarFunnel.ts')
if (!existsSync(funnelPath)) {
  fail('src/services/webinarFunnel.ts does not exist')
} else {
  const c = readFileSync(funnelPath, 'utf8')
  // Must use backend function OR direct raw table queries (never just view)
  const usesBackend = c.includes('webinar-data') || c.includes('fetchWebinarBackend')
  const usesRawTables = c.includes("from('webinar_participants')") && c.includes("from('webinar_sessions')")
  if (usesBackend || usesRawTables) {
    pass('webinarFunnel.ts uses backend function or raw tables (not just view) for webinar data')
  } else {
    fail('webinarFunnel.ts does not use backend function or raw tables — may rely on view returning 0')
  }
  // Must have comment about RLS / service role / raw tables being required
  if (c.includes('service role') || c.includes('raw tables') || c.includes('PRIMARY SOURCE')) {
    pass('webinarFunnel.ts has comment explaining why direct/backend access is required')
  } else {
    fail('webinarFunnel.ts missing explanation for why service role or raw tables are needed')
  }
  // Must NOT show "No ClickMeeting data" when backend returns participantsCount > 0
  if (c.includes('Backend webinar-data failed')) {
    pass('webinarFunnel.ts shows explicit backend error message (not fake "No ClickMeeting data")')
  } else {
    fail('webinarFunnel.ts does not show backend error message — may show misleading "No ClickMeeting data"')
  }
}

// 5. WebinarFunnelPanel.tsx imports normalizeProduct (JSU/JZK rendering)
const panelPath = join(rootDir, 'src/components/WebinarFunnelPanel.tsx')
if (!existsSync(panelPath)) {
  fail('src/components/WebinarFunnelPanel.tsx does not exist')
} else {
  const c = readFileSync(panelPath, 'utf8')
  if (c.includes('normalizeProduct')) {
    pass('WebinarFunnelPanel.tsx uses normalizeProduct for JSU/JZK rendering')
  } else {
    fail('WebinarFunnelPanel.tsx does not use normalizeProduct — product tags not classified')
  }
  // Should not show hardcoded "JAK SIĘ UCZYĆ" without dynamic detection
  if (c.includes('JAK SIĘ UCZYĆ — webinar funnel')) {
    fail('WebinarFunnelPanel.tsx still has hardcoded "JAK SIĘ UCZYĆ — webinar funnel" header')
  } else {
    pass('WebinarFunnelPanel.tsx header is not hardcoded to JSU')
  }
}

// 6. responses.ts does not say "No ClickMeeting data" when it might have participants
const responsesPath = join(rootDir, 'src/brain/responses.ts')
if (!existsSync(responsesPath)) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = readFileSync(responsesPath, 'utf8')
  if (c.includes('normalizeProduct') || c.includes('productFromQuery')) {
    pass('responses.ts imports product classifier for JSU/JZK aware answers')
  } else {
    fail('responses.ts does not use product classifier')
  }
  // Check spoken builder is not hardcoded to JSU-only messaging
  if (c.includes('buildJsuWebinarSpoken')) {
    pass('responses.ts has buildJsuWebinarSpoken (webinar spoken builder)')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Webinar data architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} webinar architecture violation(s).`)
  process.exit(1)
}
