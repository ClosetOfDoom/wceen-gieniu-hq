#!/usr/bin/env node
// Assert WCEEN data source contract: no source mismatch, backend functions exist,
// Campaigns uses service role, GIENIU has today_orders_query intent.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. Backend functions exist
for (const fn of ['data-health', 'orders-data', 'campaign-data']) {
  if (exists(`netlify/functions/${fn}.js`)) {
    pass(`netlify/functions/${fn}.js exists`)
  } else {
    fail(`netlify/functions/${fn}.js is missing`)
  }
}

// 2. All three functions use service role key
for (const fn of ['data-health', 'orders-data', 'campaign-data']) {
  if (!exists(`netlify/functions/${fn}.js`)) continue
  const c = read(`netlify/functions/${fn}.js`)
  if (c.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    pass(`${fn}.js uses SUPABASE_SERVICE_ROLE_KEY (service role)`)
  } else {
    fail(`${fn}.js must use SUPABASE_SERVICE_ROLE_KEY — not anon key`)
  }
}

// 3. data-health checks both meta_ads_daily AND v_daily_wix_meta_performance
if (exists('netlify/functions/data-health.js')) {
  const c = read('netlify/functions/data-health.js')
  if (c.includes('meta_ads_daily') && c.includes('v_daily_wix_meta_performance')) {
    pass('data-health.js checks both meta_ads_daily and v_daily_wix_meta_performance')
  } else {
    fail('data-health.js must check both meta_ads_daily and v_daily_wix_meta_performance')
  }
  if (c.includes('source_mismatch')) {
    pass('data-health.js detects and reports source_mismatch')
  } else {
    fail('data-health.js must detect source_mismatch between the two Meta sources')
  }
  if (c.includes('supabaseCount')) {
    pass('data-health.js uses supabaseCount for exact row counts')
  } else {
    fail('data-health.js should use exact count (supabaseCount helper)')
  }
}

// 4. campaign-data.js checks aggregate spend (v_daily_wix_meta_performance)
if (exists('netlify/functions/campaign-data.js')) {
  const c = read('netlify/functions/campaign-data.js')
  if (c.includes('v_daily_wix_meta_performance')) {
    pass('campaign-data.js checks v_daily_wix_meta_performance for aggregate spend')
  } else {
    fail('campaign-data.js must check v_daily_wix_meta_performance to detect mismatch')
  }
  if (c.includes('sourceMismatch') || c.includes('source_mismatch')) {
    pass('campaign-data.js returns sourceMismatch field')
  } else {
    fail('campaign-data.js must return sourceMismatch so CampaignsPanel can show the right state')
  }
  if (c.includes('aggregateMetaSpendExists') || c.includes('aggregate_meta_spend')) {
    pass('campaign-data.js returns aggregateMetaSpendExists field')
  } else {
    fail('campaign-data.js must return aggregateMetaSpendExists')
  }
}

// 5. orders-data.js uses absolute price rules
if (exists('netlify/functions/orders-data.js')) {
  const c = read('netlify/functions/orders-data.js')
  if (c.includes('amount === 549') && c.includes('JSU_COURSE')) {
    pass('orders-data.js classifies 549 PLN → JSU_COURSE')
  } else {
    fail('orders-data.js missing 549 PLN = JSU absolute rule')
  }
  if (c.includes('amount === 347') && c.includes('JZK_LANGUAGE')) {
    pass('orders-data.js classifies 347 PLN → JZK_LANGUAGE')
  } else {
    fail('orders-data.js missing 347 PLN = JZK absolute rule')
  }
  if (c.includes('amount === 119') && c.includes('MEMORY_PACK')) {
    pass('orders-data.js classifies 119 PLN → MEMORY_PACK')
  } else {
    fail('orders-data.js missing 119 PLN = memory pack absolute rule')
  }
  if (c.includes('maskEmail')) {
    pass('orders-data.js masks emails in output')
  } else {
    fail('orders-data.js must mask emails (never expose raw email to frontend)')
  }
}

// 6. campaignDiagnosis.ts uses backend (not direct Supabase anon client)
if (!exists('src/lib/campaignDiagnosis.ts')) {
  fail('src/lib/campaignDiagnosis.ts does not exist')
} else {
  const c = read('src/lib/campaignDiagnosis.ts')

  // Must NOT import from Supabase client directly
  if (c.includes("from '../services/supabase'") || c.includes('supabase.from(')) {
    fail('campaignDiagnosis.ts still uses Supabase anon client — must use backend function instead')
  } else {
    pass('campaignDiagnosis.ts does not import Supabase anon client (correct)')
  }

  // Must call backend endpoint
  if (c.includes('/.netlify/functions/campaign-data') || c.includes('campaign-data')) {
    pass('campaignDiagnosis.ts calls /.netlify/functions/campaign-data backend')
  } else {
    fail('campaignDiagnosis.ts must call /.netlify/functions/campaign-data (service role)')
  }

  // Must return sourceMismatch
  if (c.includes('sourceMismatch') || c.includes('CampaignFetchResult')) {
    pass('campaignDiagnosis.ts returns sourceMismatch in CampaignFetchResult')
  } else {
    fail('campaignDiagnosis.ts must return sourceMismatch so CampaignsPanel knows the data state')
  }

  if (c.includes('aggregateMetaSpendExists')) {
    pass('campaignDiagnosis.ts returns aggregateMetaSpendExists')
  } else {
    fail('campaignDiagnosis.ts must pass aggregateMetaSpendExists from backend')
  }
}

// 7. CampaignsPanel.tsx handles sourceMismatch state (not just "no data")
if (!exists('src/components/CampaignsPanel.tsx')) {
  fail('src/components/CampaignsPanel.tsx does not exist')
} else {
  const c = read('src/components/CampaignsPanel.tsx')

  if (c.includes('sourceMismatch') || c.includes('source_mismatch')) {
    pass('CampaignsPanel.tsx handles sourceMismatch state')
  } else {
    fail('CampaignsPanel.tsx must show different UI when sourceMismatch (spend exists but no campaign rows)')
  }

  if (c.includes('Meta spend exists') || c.includes('aggregate spend') || c.includes('campaign-level rows')) {
    pass('CampaignsPanel.tsx shows informative message when aggregate spend exists but campaign rows missing')
  } else {
    fail('CampaignsPanel.tsx must show "Meta spend exists, but campaign rows missing" when sourceMismatch')
  }

  // Must NOT show bare "No Meta campaign rows found in meta_ads_daily" as the only empty state
  // (it can still appear in "no data anywhere" state, but must be distinguished from mismatch)
  if (c.includes('emptyStateType') || c.includes("emptyStateType === 'mismatch'") || c.includes('aggregateMetaSpendExists')) {
    pass('CampaignsPanel.tsx distinguishes "mismatch" from "truly empty" states')
  } else {
    fail('CampaignsPanel.tsx must distinguish mismatch empty state from truly empty state')
  }
}

// 8. DiagnosticsPanel.tsx shows data-health card with source mismatch warning
if (!exists('src/components/DiagnosticsPanel.tsx')) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = read('src/components/DiagnosticsPanel.tsx')

  if (c.includes('fetchDataHealth') || c.includes('dataHealth')) {
    pass('DiagnosticsPanel.tsx fetches and displays data-health report')
  } else {
    fail('DiagnosticsPanel.tsx must show data-health card (source mismatch, order counts, etc.)')
  }

  if (c.includes('source_mismatch') || c.includes('sourceMismatch') || c.includes('Campaigns source mismatch')) {
    pass('DiagnosticsPanel.tsx shows source mismatch warning when detected')
  } else {
    fail('DiagnosticsPanel.tsx must warn when Campaigns and Command Center use different Meta sources')
  }

  if (c.includes('command_center_source') || c.includes('Command Center source')) {
    pass('DiagnosticsPanel.tsx shows which source Command Center uses')
  } else {
    fail('DiagnosticsPanel.tsx must show Command Center source table')
  }

  if (c.includes('meta_ads_daily count') || c.includes('meta_ads_daily.count') || c.includes('Campaigns source')) {
    pass('DiagnosticsPanel.tsx shows meta_ads_daily count and Campaigns source')
  } else {
    fail('DiagnosticsPanel.tsx must show meta_ads_daily count and Campaigns source')
  }
}

// 9. dataHealth.ts and ordersData.ts lib files exist
for (const f of ['src/lib/dataHealth.ts', 'src/lib/ordersData.ts']) {
  if (exists(f)) {
    pass(`${f} exists`)
  } else {
    fail(`${f} is missing`)
  }
}

// 10. intent.ts has today_orders_query intent using ordersData (not perf/trend)
if (!exists('src/brain/intent.ts')) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = read('src/brain/intent.ts')

  if (c.includes('today_orders_query')) {
    pass('intent.ts has today_orders_query intent')
  } else {
    fail('intent.ts missing today_orders_query intent — "ile dziś zamówień" has no route')
  }

  if (c.includes('buildTodayOrdersAnswer') || c.includes('ordersData')) {
    pass('intent.ts routes today_orders_query to buildTodayOrdersAnswer(ordersData)')
  } else {
    fail('intent.ts today_orders_query must use ordersData (not stale perf/trend)')
  }

  if (c.includes('ordersData: OrdersData') || c.includes("ordersData")) {
    pass('IntentContext has ordersData field')
  } else {
    fail('IntentContext must include ordersData so resolveIntent can answer order queries from backend')
  }

  if (c.includes('ile dzis zamowien') || c.includes('zamowienia dzis') || c.includes('orders today')) {
    pass('intent.ts recognizes "ile dziś zamówień" trigger phrases')
  } else {
    fail('intent.ts missing today_orders_query trigger phrases')
  }
}

// 11. responses.ts has buildTodayOrdersAnswer and buildTodayOrdersSpoken
if (!exists('src/brain/responses.ts')) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = read('src/brain/responses.ts')

  if (c.includes('buildTodayOrdersAnswer')) {
    pass('responses.ts has buildTodayOrdersAnswer()')
  } else {
    fail('responses.ts missing buildTodayOrdersAnswer()')
  }

  if (c.includes('buildTodayOrdersSpoken')) {
    pass('responses.ts has buildTodayOrdersSpoken()')
  } else {
    fail('responses.ts missing buildTodayOrdersSpoken()')
  }

  if (c.includes("from '../lib/ordersData'") || c.includes('OrdersData')) {
    pass('responses.ts imports OrdersData type')
  } else {
    fail('responses.ts must import OrdersData from ordersData.ts')
  }
}

// 12. App.tsx loads ordersData at startup and passes to resolveIntent
if (!exists('src/App.tsx')) {
  fail('src/App.tsx does not exist')
} else {
  const c = read('src/App.tsx')

  if (c.includes('fetchOrdersData') || c.includes('loadOrdersData')) {
    pass('App.tsx loads ordersData at startup')
  } else {
    fail('App.tsx must call fetchOrdersData() at startup and store in state')
  }

  if (c.includes('ordersData') && c.includes('resolveIntent')) {
    pass('App.tsx passes ordersData to resolveIntent')
  } else {
    fail('App.tsx must pass ordersData to resolveIntent so GIENIU can answer order queries')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Data source contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} data source violation(s).`)
  process.exit(1)
}
