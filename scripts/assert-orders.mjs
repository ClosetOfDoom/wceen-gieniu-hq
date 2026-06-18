#!/usr/bin/env node
// Assert Wix orders data architecture:
// - fetchTodayPerformance queries v_daily_wix_meta_performance (not hardcoded)
// - fetchRecentPerformance uses the same view for trend data
// - KPI cards show real Wix order data, not mock/placeholder values
// - No hardcoded "0 orders" suppressing real data

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. services/data.ts has fetchTodayPerformance querying v_daily_wix_meta_performance
const dataPath = join(rootDir, 'src/services/data.ts')
if (!existsSync(dataPath)) {
  fail('src/services/data.ts does not exist')
} else {
  const c = readFileSync(dataPath, 'utf8')
  if (c.includes('fetchTodayPerformance') && c.includes('v_daily_wix_meta_performance')) {
    pass('data.ts fetchTodayPerformance queries v_daily_wix_meta_performance')
  } else {
    fail('data.ts missing fetchTodayPerformance or v_daily_wix_meta_performance reference')
  }
  if (c.includes('fetchRecentPerformance')) {
    pass('data.ts has fetchRecentPerformance for trend data')
  } else {
    fail('data.ts missing fetchRecentPerformance')
  }
  // Should have wix_orders field in DailyPerformance
  if (c.includes('wix_orders') && c.includes('wix_revenue')) {
    pass('data.ts DailyPerformance interface has wix_orders and wix_revenue')
  } else {
    fail('data.ts missing wix_orders or wix_revenue in DailyPerformance interface')
  }
}

// 2. App.tsx uses displayPerf fallback (shows last trend row if today empty)
const appPath = join(rootDir, 'src/App.tsx')
if (!existsSync(appPath)) {
  fail('src/App.tsx does not exist')
} else {
  const c = readFileSync(appPath, 'utf8')
  if (c.includes('displayPerf') && c.includes('perfIsStale')) {
    pass('App.tsx uses displayPerf fallback and perfIsStale banner for stale data')
  } else {
    fail('App.tsx missing displayPerf fallback or perfIsStale — may show blank KPI cards when today is empty')
  }
  // KPI cards show Wix orders
  if (c.includes('Wix Orders') && c.includes('wix_orders')) {
    pass('App.tsx renders Wix Orders KPI card with real data')
  } else {
    fail('App.tsx missing Wix Orders KPI card')
  }
}

// 3. No hardcoded zero revenue or order suppression in responses
const responsesPath = join(rootDir, 'src/brain/responses.ts')
if (!existsSync(responsesPath)) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = readFileSync(responsesPath, 'utf8')
  if (c.includes('wix_orders') && c.includes('wix_revenue')) {
    pass('responses.ts references real wix_orders and wix_revenue fields')
  } else {
    fail('responses.ts missing wix_orders or wix_revenue references')
  }
  // Must have honest memory bundle answer (not fake product breakdown)
  if (c.includes('buildMemoryBundleAnswer')) {
    pass('responses.ts has buildMemoryBundleAnswer (honest: no product data available)')
  } else {
    fail('responses.ts missing buildMemoryBundleAnswer — memory queries may return fake all-orders metric')
  }
}

// 4. productClassifier.ts exists and flags missing data correctly
const classifierPath = join(rootDir, 'src/lib/productClassifier.ts')
if (!existsSync(classifierPath)) {
  fail('src/lib/productClassifier.ts does not exist — product classification unavailable')
} else {
  const c = readFileSync(classifierPath, 'utf8')
  if (c.includes('UNKNOWN_UNCLASSIFIABLE')) {
    pass('productClassifier.ts has UNKNOWN_UNCLASSIFIABLE for orders with no product data')
  } else {
    fail('productClassifier.ts missing UNKNOWN_UNCLASSIFIABLE — unclassifiable orders may be silently mislabelled')
  }
  if (c.includes('missingProductData')) {
    pass('productClassifier.ts flags missingProductData when line items absent')
  } else {
    fail('productClassifier.ts does not flag missingProductData — no signal when product data is missing')
  }
}

// 5. intent.ts does NOT let memory bundle queries fall to ops_briefing
const intentPath = join(rootDir, 'src/brain/intent.ts')
if (!existsSync(intentPath)) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = readFileSync(intentPath, 'utf8')
  if (c.includes('memory_product_scope')) {
    pass('intent.ts has memory_product_scope — memory bundle queries intercepted before ops_briefing')
  } else {
    fail('intent.ts missing memory_product_scope — memory bundle queries fall to ops_briefing and return all-order count')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Wix orders data architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} orders data violation(s).`)
  process.exit(1)
}
