#!/usr/bin/env node
// Assert ops-week-report architecture rules.
// Verifies: backend function, frontend types, intent wiring, responses, diagnostics.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. Backend function exists and uses service role key
if (!exists('netlify/functions/ops-week-report.js')) {
  fail('netlify/functions/ops-week-report.js does not exist')
} else {
  const c = read('netlify/functions/ops-week-report.js')
  if (c.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    pass('ops-week-report.js uses SUPABASE_SERVICE_ROLE_KEY (service role)')
  } else {
    fail('ops-week-report.js does not use SUPABASE_SERVICE_ROLE_KEY')
  }
  if (c.includes('webinar_sessions') && c.includes('webinar_participants')) {
    pass('ops-week-report.js queries webinar_sessions and webinar_participants')
  } else {
    fail('ops-week-report.js does not query both webinar tables')
  }
  if (c.includes('v_daily_wix_meta_performance')) {
    pass('ops-week-report.js queries v_daily_wix_meta_performance for aggregate orders')
  } else {
    fail('ops-week-report.js does not query v_daily_wix_meta_performance')
  }
  if (c.includes('wix_orders')) {
    pass('ops-week-report.js attempts wix_orders for product classification')
  } else {
    fail('ops-week-report.js does not attempt wix_orders table')
  }
  if (c.includes('getWarsawRanges') || c.includes('Europe/Warsaw')) {
    pass('ops-week-report.js uses Warsaw timezone for date ranges')
  } else {
    fail('ops-week-report.js does not use Warsaw timezone — date ranges will be wrong')
  }
  if (c.includes('JSU_COURSE') && c.includes('MEMORY_PACK') && c.includes('JZK_LANGUAGE')) {
    pass('ops-week-report.js classifies JSU_COURSE, MEMORY_PACK, JZK_LANGUAGE')
  } else {
    fail('ops-week-report.js missing product classification labels')
  }
  if (c.includes('isJsuSession')) {
    pass('ops-week-report.js has isJsuSession() classifier for webinar sessions')
  } else {
    fail('ops-week-report.js missing isJsuSession() — cannot identify JSU sessions')
  }
  if (c.includes('attribution') && c.includes('email')) {
    pass('ops-week-report.js includes email attribution logic')
  } else {
    fail('ops-week-report.js missing attribution logic')
  }
  // Must NOT expose raw emails to the response
  if (c.includes('email_masked') || !c.includes('"email":') || c.includes('maskEmail')) {
    pass('ops-week-report.js does not expose raw emails in JSON response')
  }
  if (c.includes('yesterday') && c.includes('weekStart')) {
    pass('ops-week-report.js separates yesterday vs week range queries')
  } else {
    fail('ops-week-report.js does not distinguish yesterday from week range')
  }
}

// 2. Frontend lib exists with correct types
if (!exists('src/lib/opsWeekReport.ts')) {
  fail('src/lib/opsWeekReport.ts does not exist')
} else {
  const c = read('src/lib/opsWeekReport.ts')
  if (c.includes('OpsWeekReport') && c.includes('fetchOpsWeekReport')) {
    pass('opsWeekReport.ts exports OpsWeekReport type and fetchOpsWeekReport()')
  } else {
    fail('opsWeekReport.ts missing OpsWeekReport type or fetchOpsWeekReport function')
  }
  if (c.includes('ops-week-report')) {
    pass('opsWeekReport.ts fetches from /.netlify/functions/ops-week-report')
  } else {
    fail('opsWeekReport.ts does not reference the ops-week-report function endpoint')
  }
  if (c.includes('120_000') || c.includes('120000')) {
    pass('opsWeekReport.ts has 2-minute cache to avoid repeated fetches')
  } else {
    fail('opsWeekReport.ts missing cache — will re-fetch on every query')
  }
}

// 3. Intent handlers exist in intent.ts
const intentPath = 'src/brain/intent.ts'
if (!exists(intentPath)) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = read(intentPath)
  if (c.includes("'opsWeekReport'") || c.includes('opsWeekReport')) {
    pass('intent.ts includes opsWeekReport in context')
  } else {
    fail('intent.ts does not include opsWeekReport in IntentContext')
  }
  if (c.includes("'jsu_week_report'") || c.includes('jsu_week_report')) {
    pass('intent.ts has jsu_week_report intent')
  } else {
    fail('intent.ts missing jsu_week_report intent handler')
  }
  if (c.includes("'jsu_sales_query'") || c.includes('jsu_sales_query')) {
    pass('intent.ts has jsu_sales_query intent')
  } else {
    fail('intent.ts missing jsu_sales_query intent handler')
  }
  if (c.includes('co bylo w tym tygodniu') || c.includes('raport tygodnia')) {
    pass('intent.ts recognizes Polish "co bylo w tym tygodniu" / "raport tygodnia"')
  } else {
    fail('intent.ts missing Polish week report trigger phrases')
  }
  if (c.includes('ile zeszlo jsu') || c.includes('ile sprzedalo jsu')) {
    pass('intent.ts recognizes "ile zeszło JSU" query')
  } else {
    fail('intent.ts missing "ile zeszlo jsu" trigger phrase')
  }
  // jsu_week_report must come BEFORE webinar_funnel handler
  const weekIdx = c.indexOf('jsu_week_report')
  const webinarIdx = c.indexOf("'webinar_funnel'")
  if (weekIdx > 0 && webinarIdx > 0 && weekIdx < webinarIdx) {
    pass('jsu_week_report handler is positioned BEFORE webinar_funnel (correct priority)')
  } else {
    fail('jsu_week_report handler must be BEFORE webinar_funnel — otherwise "jsu" keyword hijacks the route')
  }
  // jsu_sales_query must come BEFORE memory_product_scope (which also catches 'ile jsu')
  const salesIdx = c.indexOf('jsu_sales_query')
  const memIdx   = c.indexOf('memory_product_scope')
  if (salesIdx > 0 && memIdx > 0 && salesIdx < memIdx) {
    pass('jsu_sales_query handler is positioned BEFORE memory_product_scope (correct priority)')
  } else {
    fail('jsu_sales_query must be BEFORE memory_product_scope — otherwise "ile jsu" routes incorrectly')
  }
}

// 4. Response builders exist in responses.ts
if (!exists('src/brain/responses.ts')) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = read('src/brain/responses.ts')
  if (c.includes('buildJsuWeekReport')) {
    pass('responses.ts has buildJsuWeekReport()')
  } else {
    fail('responses.ts missing buildJsuWeekReport()')
  }
  if (c.includes('buildJsuWeekReportSpoken')) {
    pass('responses.ts has buildJsuWeekReportSpoken()')
  } else {
    fail('responses.ts missing buildJsuWeekReportSpoken()')
  }
  if (c.includes('buildJsuSalesAnswer')) {
    pass('responses.ts has buildJsuSalesAnswer()')
  } else {
    fail('responses.ts missing buildJsuSalesAnswer()')
  }
  if (c.includes('buildJsuSalesSpoken')) {
    pass('responses.ts has buildJsuSalesSpoken()')
  } else {
    fail('responses.ts missing buildJsuSalesSpoken()')
  }
  // Must NOT say "11 Wix orders" as JSU sales (must distinguish)
  const hasHonestOrders = c.includes('all_orders') && c.includes('jsu_course_orders')
  if (hasHonestOrders) {
    pass('responses.ts distinguishes all_orders from jsu_course_orders (honest JSU count)')
  } else {
    fail('responses.ts does not separate all_orders from jsu_course_orders — JSU count would be wrong')
  }
  // Must say "not counting all X Wix orders" when reporting JSU
  if (c.includes('not counting') || c.includes('NOT counting') || c.includes('Only JSU') || c.includes('only orders classified')) {
    pass('responses.ts explicitly states it is not counting all Wix orders as JSU')
  } else {
    fail('responses.ts does not clarify that JSU orders ≠ all Wix orders')
  }
}

// 5. App.tsx wires opsWeekReport
if (!exists('src/App.tsx')) {
  fail('src/App.tsx does not exist')
} else {
  const c = read('src/App.tsx')
  if (c.includes('fetchOpsWeekReport')) {
    pass('App.tsx imports and calls fetchOpsWeekReport')
  } else {
    fail('App.tsx does not import fetchOpsWeekReport')
  }
  if (c.includes('opsWeekReport') && c.includes('setOpsWeekReport')) {
    pass('App.tsx has opsWeekReport state')
  } else {
    fail('App.tsx missing opsWeekReport state')
  }
  if (c.includes('loadOpsWeekReport')) {
    pass('App.tsx has loadOpsWeekReport loader callback')
  } else {
    fail('App.tsx missing loadOpsWeekReport callback')
  }
  // Must pass opsWeekReport to resolveIntent (use lastIndexOf to skip the import line)
  if (c.includes('opsWeekReport') && c.includes('resolveIntent')) {
    const resolveIdx = c.lastIndexOf('resolveIntent')
    const reportInCtx = c.slice(resolveIdx, resolveIdx + 300).includes('opsWeekReport')
    if (reportInCtx) {
      pass('App.tsx passes opsWeekReport to resolveIntent context')
    } else {
      fail('App.tsx does not pass opsWeekReport to resolveIntent — intents cannot use week data')
    }
  } else {
    fail('App.tsx not passing opsWeekReport to resolveIntent')
  }
}

// 6. DiagnosticsPanel shows ops week report card
if (!exists('src/components/DiagnosticsPanel.tsx')) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = read('src/components/DiagnosticsPanel.tsx')
  if (c.includes('opsWeekReport')) {
    pass('DiagnosticsPanel.tsx shows ops week report')
  } else {
    fail('DiagnosticsPanel.tsx does not display ops week report')
  }
  if (c.includes('jsu_sessions') || c.includes('jsu_participants') || c.includes('jsu_webinar_ran_yesterday')) {
    pass('DiagnosticsPanel.tsx shows JSU session/participant counts from week report')
  } else {
    fail('DiagnosticsPanel.tsx missing JSU session/participant counts from week report')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Ops week report architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} ops-week-report architecture violation(s).`)
  process.exit(1)
}
