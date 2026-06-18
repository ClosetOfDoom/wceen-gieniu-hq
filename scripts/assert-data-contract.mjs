#!/usr/bin/env node
// Assert data contract integrity:
// - productClassifier.ts exists with correct exports and PRODUCT_CLASSIFICATION_AVAILABLE = false
// - dataAudit.ts exists and queries wix_orders
// - intent.ts has memory_product_scope intent handler
// - responses.ts has buildMemoryBundleAnswer (no fake product counts)
// - intent.ts does NOT route memory bundle queries to ops_briefing (which shows all orders)
// - SQL migration exists for wix_order_items

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. productClassifier.ts exists with required exports
const classifierPath = join(rootDir, 'src/lib/productClassifier.ts')
if (!existsSync(classifierPath)) {
  fail('src/lib/productClassifier.ts does not exist')
} else {
  const c = readFileSync(classifierPath, 'utf8')
  if (c.includes("'MEMORY_PACK'") && c.includes("'JSU_COURSE'") && c.includes("'UNKNOWN_UNCLASSIFIABLE'")) {
    pass('productClassifier.ts has ProductLine enum with MEMORY_PACK, JSU_COURSE, UNKNOWN_UNCLASSIFIABLE')
  } else {
    fail('productClassifier.ts missing ProductLine values')
  }
  if (c.includes('normalizeText') && c.includes('classifyProductName') && c.includes('classifyOrder')) {
    pass('productClassifier.ts exports normalizeText, classifyProductName, classifyOrder')
  } else {
    fail('productClassifier.ts missing required function exports')
  }
  if (c.includes('missingProductData: true')) {
    pass('productClassifier.ts sets missingProductData: true when line items absent')
  } else {
    fail('productClassifier.ts does not set missingProductData: true — will not flag missing data')
  }
  if (c.includes('PRODUCT_CLASSIFICATION_AVAILABLE = false')) {
    pass('productClassifier.ts has PRODUCT_CLASSIFICATION_AVAILABLE = false (current state)')
  } else {
    fail('productClassifier.ts missing PRODUCT_CLASSIFICATION_AVAILABLE constant or it is not false')
  }
}

// 2. dataAudit.ts exists and checks wix_orders
const auditPath = join(rootDir, 'src/lib/dataAudit.ts')
if (!existsSync(auditPath)) {
  fail('src/lib/dataAudit.ts does not exist')
} else {
  const c = readFileSync(auditPath, 'utf8')
  if (c.includes("from('wix_orders')")) {
    pass('dataAudit.ts queries wix_orders table')
  } else {
    fail('dataAudit.ts does not query wix_orders')
  }
  if (c.includes('classificationAvailable') && c.includes('hasProductName')) {
    pass('dataAudit.ts reports classificationAvailable and hasProductName')
  } else {
    fail('dataAudit.ts missing classificationAvailable or hasProductName fields')
  }
  if (c.includes('fetchDataContract')) {
    pass('dataAudit.ts exports fetchDataContract')
  } else {
    fail('dataAudit.ts missing fetchDataContract export')
  }
}

// 3. responses.ts has buildMemoryBundleAnswer with honest "cannot classify" message
const responsesPath = join(rootDir, 'src/brain/responses.ts')
if (!existsSync(responsesPath)) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = readFileSync(responsesPath, 'utf8')
  if (c.includes('buildMemoryBundleAnswer') && c.includes('buildMemoryBundleSpoken')) {
    pass('responses.ts exports buildMemoryBundleAnswer and buildMemoryBundleSpoken')
  } else {
    fail('responses.ts missing buildMemoryBundleAnswer or buildMemoryBundleSpoken')
  }
  if (c.includes('Product classification is unavailable') || c.includes('cannot classify')) {
    pass('responses.ts buildMemoryBundleAnswer tells user product classification is unavailable')
  } else {
    fail('responses.ts buildMemoryBundleAnswer does not mention classification unavailability — may fake metrics')
  }
  // Must NOT use all-order totals as memory-bundle answer (no fake metrics)
  if (c.includes('wix_orders_product_mapping_fix') || c.includes('line items')) {
    pass('responses.ts buildMemoryBundleAnswer references fix documentation or line items requirement')
  } else {
    fail('responses.ts buildMemoryBundleAnswer does not explain how to fix the data gap')
  }
  // buildAdsDiagnosisSpoken should NOT use the old broken "No campaign data for today yet." message
  if (c.includes('No campaign data for today yet. Check the automation panel.')) {
    fail('responses.ts buildAdsDiagnosisSpoken still has the old "No campaign data for today yet." message — update it')
  } else {
    pass('responses.ts buildAdsDiagnosisSpoken has updated no-data message')
  }
}

// 4. intent.ts has memory_product_scope handler and does NOT route memory to ops_briefing
const intentPath = join(rootDir, 'src/brain/intent.ts')
if (!existsSync(intentPath)) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = readFileSync(intentPath, 'utf8')
  if (c.includes("'memory_product_scope'") || c.includes('"memory_product_scope"')) {
    pass('intent.ts has memory_product_scope intent handler')
  } else {
    fail('intent.ts missing memory_product_scope intent — memory bundle queries fall through to ops_briefing (shows all orders)')
  }
  if (c.includes('buildMemoryBundleAnswer')) {
    pass('intent.ts routes memory bundle queries to buildMemoryBundleAnswer')
  } else {
    fail('intent.ts does not call buildMemoryBundleAnswer — memory bundle queries not handled')
  }
  // memory_product_scope must come BEFORE the ops_briefing CATCH-ALL (the last one, not the initial default)
  const memIdx     = c.indexOf('memory_product_scope')
  const lastOpsIdx = c.lastIndexOf("'ops_briefing'")
  if (memIdx !== -1 && memIdx < lastOpsIdx) {
    pass('intent.ts memory_product_scope handler is registered before ops_briefing catch-all')
  } else {
    fail('intent.ts memory_product_scope is AFTER the last ops_briefing — memory queries may still hit ops_briefing')
  }
}

// 5. DiagnosticsPanel.tsx imports dataAudit
const diagPath = join(rootDir, 'src/components/DiagnosticsPanel.tsx')
if (!existsSync(diagPath)) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = readFileSync(diagPath, 'utf8')
  if (c.includes('fetchDataContract')) {
    pass('DiagnosticsPanel.tsx uses fetchDataContract to show product data contract status')
  } else {
    fail('DiagnosticsPanel.tsx does not show product data contract status')
  }
  if (c.includes('classificationAvailable') || c.includes('Product Data Contract') || c.includes('Product classification')) {
    pass('DiagnosticsPanel.tsx shows product classification availability')
  } else {
    fail('DiagnosticsPanel.tsx does not surface product classification status')
  }
}

// 6. SQL migration exists
const sqlPath = join(rootDir, 'supabase/migrations/add_order_items_for_product_scoping.sql')
if (!existsSync(sqlPath)) {
  fail('supabase/migrations/add_order_items_for_product_scoping.sql does not exist')
} else {
  const c = readFileSync(sqlPath, 'utf8')
  if (c.includes('wix_order_items') && c.includes('product_name') && c.includes('product_sku')) {
    pass('SQL migration creates wix_order_items with product_name and product_sku columns')
  } else {
    fail('SQL migration missing wix_order_items, product_name, or product_sku')
  }
}

// 7. Docs exist
const docsPath = join(rootDir, 'docs/wix_orders_product_mapping_fix.md')
if (!existsSync(docsPath)) {
  fail('docs/wix_orders_product_mapping_fix.md does not exist')
} else {
  pass('docs/wix_orders_product_mapping_fix.md exists')
}

console.log()
if (errors === 0) {
  console.log('PASS — Data contract integrity rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} data contract violation(s).`)
  process.exit(1)
}
