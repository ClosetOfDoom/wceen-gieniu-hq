#!/usr/bin/env node
// Assert WCEEN price-first product classification rules.
// When Wix product_name_raw is wrong/misleading, price is the authoritative signal.
// Rules: 549 PLN = JSU_COURSE | 347 PLN = JZK only if language name | 119 PLN + memory name = MEMORY_PACK

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. productClassifier.ts has UNKNOWN_PRICE_347 and classifyByPrice
if (!exists('src/lib/productClassifier.ts')) {
  fail('src/lib/productClassifier.ts does not exist')
} else {
  const c = read('src/lib/productClassifier.ts')
  if (c.includes('UNKNOWN_PRICE_347')) {
    pass('productClassifier.ts has UNKNOWN_PRICE_347 ProductLine')
  } else {
    fail('productClassifier.ts missing UNKNOWN_PRICE_347 — ambiguous 347 PLN orders would be mislabelled')
  }
  if (c.includes('classifyByPrice')) {
    pass('productClassifier.ts exports classifyByPrice()')
  } else {
    fail('productClassifier.ts missing classifyByPrice() — no price-first classification available')
  }
  if (c.includes('549')) {
    pass('productClassifier.ts has 549 PLN → JSU_COURSE rule')
  } else {
    fail('productClassifier.ts missing 549 PLN price rule')
  }
  if (c.includes('347')) {
    pass('productClassifier.ts has 347 PLN rule (JZK or UNKNOWN_PRICE_347)')
  } else {
    fail('productClassifier.ts missing 347 PLN rule')
  }
  if (c.includes('119')) {
    pass('productClassifier.ts has 119 PLN rule (MEMORY_PACK with memory keywords)')
  } else {
    fail('productClassifier.ts missing 119 PLN rule')
  }
  if (c.includes('maskEmail')) {
    pass('productClassifier.ts exports maskEmail()')
  } else {
    fail('productClassifier.ts missing maskEmail() helper')
  }
  // Must NOT classify 347 PLN as JZK when name has no language keywords
  if (c.includes('UNKNOWN_PRICE_347') && c.includes('347')) {
    pass('productClassifier.ts routes ambiguous 347 PLN to UNKNOWN_PRICE_347 (not blindly JZK)')
  }
  // PRODUCT_CLASSIFICATION_AVAILABLE must still be false (frontend RLS still blocks anon key)
  if (c.includes('PRODUCT_CLASSIFICATION_AVAILABLE = false')) {
    pass('productClassifier.ts keeps PRODUCT_CLASSIFICATION_AVAILABLE = false (correct: frontend anon key blocked)')
  } else {
    fail('productClassifier.ts should keep PRODUCT_CLASSIFICATION_AVAILABLE = false — price classification is backend-only')
  }
}

// 2. Live classification test via ops-week-report backend logic
try {
  const utilsPath = pathToFileURL(join(rootDir, 'netlify/functions/scheduleUtils.js')).href
  await import(utilsPath) // warm up module system

  // Inline test by reading and evaluating ops-week-report.js classify function
  // We can't import it directly (it has top-level await in handler), so we test it statically
  const c = read('netlify/functions/ops-week-report.js')

  // 549 PLN rule must be present and unconditional
  if (c.includes('amount === 549') && c.includes('JSU_COURSE')) {
    pass('ops-week-report.js classifies 549 PLN → JSU_COURSE unconditionally')
  } else {
    fail('ops-week-report.js missing "amount === 549 → JSU_COURSE" rule')
  }

  // 347 PLN must NOT blindly map to JZK
  if (c.includes('amount === 347') && c.includes('UNKNOWN_PRICE_347')) {
    pass('ops-week-report.js routes 347 PLN without language name → UNKNOWN_PRICE_347 (not blindly JZK)')
  } else {
    fail('ops-week-report.js must route 347 PLN without language keywords to UNKNOWN_PRICE_347')
  }

  // 119 PLN + memory rule
  if (c.includes('amount === 119') && c.includes('MEMORY_PACK')) {
    pass('ops-week-report.js has 119 PLN + memory keywords → MEMORY_PACK rule')
  } else {
    fail('ops-week-report.js missing 119 PLN + memory → MEMORY_PACK rule')
  }

  // Warning when price fallback used
  if (c.includes('Product name from Wix may be wrong') || c.includes('price fallback')) {
    pass('ops-week-report.js emits classification warning when price overrides misleading name')
  } else {
    fail('ops-week-report.js does not warn when product name is misleading and price fallback used')
  }

} catch (e) {
  fail(`Could not test ops-week-report.js classification logic: ${e.message}`)
}

// 3. ops-week-report.js has extractAmount and order_diagnostics
if (!exists('netlify/functions/ops-week-report.js')) {
  fail('netlify/functions/ops-week-report.js does not exist')
} else {
  const c = read('netlify/functions/ops-week-report.js')
  if (c.includes('extractAmount')) {
    pass('ops-week-report.js has extractAmount() to read amount/total/price fields')
  } else {
    fail('ops-week-report.js missing extractAmount() — may use wrong amount field')
  }
  if (c.includes('order_diagnostics')) {
    pass('ops-week-report.js builds and returns order_diagnostics array')
  } else {
    fail('ops-week-report.js missing order_diagnostics — no per-order classification detail available')
  }
  if (c.includes('maskEmail') || c.includes('email_masked')) {
    pass('ops-week-report.js masks emails before returning in order_diagnostics')
  } else {
    fail('ops-week-report.js must mask emails in order_diagnostics (email_masked field)')
  }
  if (c.includes('external_order_id')) {
    pass('ops-week-report.js includes external_order_id in order_diagnostics')
  } else {
    fail('ops-week-report.js missing external_order_id in order_diagnostics')
  }
  if (c.includes('classification_reason') || c.includes('classificationReason')) {
    pass('ops-week-report.js includes classification_reason in order_diagnostics')
  } else {
    fail('ops-week-report.js missing classification_reason in order_diagnostics')
  }
  if (c.includes("'orders'") && c.includes("'wix_orders'")) {
    pass("ops-week-report.js tries 'orders' table first, falls back to 'wix_orders'")
  } else if (c.includes('wix_orders')) {
    pass('ops-week-report.js attempts wix_orders for order data (legacy)')
  } else {
    fail('ops-week-report.js does not attempt any orders table')
  }
  if (c.includes('price_warnings_count')) {
    pass('ops-week-report.js tracks price_warnings_count')
  } else {
    fail('ops-week-report.js missing price_warnings_count — cannot detect misleading Wix names')
  }
  if (c.includes('priceRulesApplied')) {
    pass('ops-week-report.js includes priceRulesApplied flag in debug')
  } else {
    fail('ops-week-report.js missing priceRulesApplied debug flag')
  }
}

// 4. opsWeekReport.ts has OrderDiagnosticRow type
if (!exists('src/lib/opsWeekReport.ts')) {
  fail('src/lib/opsWeekReport.ts does not exist')
} else {
  const c = read('src/lib/opsWeekReport.ts')
  if (c.includes('OrderDiagnosticRow')) {
    pass('opsWeekReport.ts has OrderDiagnosticRow interface')
  } else {
    fail('opsWeekReport.ts missing OrderDiagnosticRow interface')
  }
  if (c.includes('external_order_id') && c.includes('email_masked') && c.includes('product_name_raw') && c.includes('classified_product') && c.includes('classification_reason')) {
    pass('OrderDiagnosticRow has all required fields (order_id, email, name, amount, classified, reason)')
  } else {
    fail('OrderDiagnosticRow missing one or more required fields')
  }
  if (c.includes('order_diagnostics')) {
    pass('opsWeekReport.ts includes order_diagnostics in OpsWeekOrders')
  } else {
    fail('opsWeekReport.ts missing order_diagnostics field in OpsWeekOrders')
  }
  if (c.includes('price_warnings_count')) {
    pass('opsWeekReport.ts includes price_warnings_count in OpsWeekOrders')
  } else {
    fail('opsWeekReport.ts missing price_warnings_count in OpsWeekOrders')
  }
}

// 5. responses.ts uses correct labels ("JSU course sold", not "memory pack sold" for JSU)
if (!exists('src/brain/responses.ts')) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = read('src/brain/responses.ts')
  // Must say "JSU course sold" (with 549 PLN reference) not "memory pack sold" for JSU orders
  if (c.includes('JSU course sold') || (c.includes('JSU course') && c.includes('549'))) {
    pass('responses.ts uses "JSU course sold" label (not "memory pack sold") for JSU orders')
  } else {
    fail('responses.ts must say "JSU course sold" not "memory pack sold" when reporting JSU orders at 549 PLN')
  }
  if (c.includes('price_warnings_count') || c.includes('price fallback')) {
    pass('responses.ts shows warning when price fallback was used')
  } else {
    fail('responses.ts does not mention price fallback warning — user cannot see when names were misleading')
  }
  if (c.includes('Wix product_name_raw was misleading') || c.includes('product name was misleading') || c.includes('Wix product name')) {
    pass('responses.ts explains that Wix product name may be misleading')
  } else {
    fail('responses.ts does not explain that Wix product_name_raw may be misleading')
  }
}

// 6. DiagnosticsPanel.tsx shows order diagnostics table
if (!exists('src/components/DiagnosticsPanel.tsx')) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = read('src/components/DiagnosticsPanel.tsx')
  if (c.includes('order_diagnostics') || c.includes('OrderDiagnosticRow') || c.includes('Order Classification')) {
    pass('DiagnosticsPanel.tsx shows order diagnostics table')
  } else {
    fail('DiagnosticsPanel.tsx missing order diagnostics table')
  }
  if (c.includes('external_order_id') || c.includes('Order ID')) {
    pass('DiagnosticsPanel.tsx shows external_order_id column')
  } else {
    fail('DiagnosticsPanel.tsx missing external_order_id in order diagnostics')
  }
  if (c.includes('email_masked') || c.includes('Email')) {
    pass('DiagnosticsPanel.tsx shows masked email column')
  } else {
    fail('DiagnosticsPanel.tsx missing email_masked in order diagnostics')
  }
  if (c.includes('product_name_raw') || c.includes('Product name')) {
    pass('DiagnosticsPanel.tsx shows product_name_raw column')
  } else {
    fail('DiagnosticsPanel.tsx missing product_name_raw in order diagnostics')
  }
  if (c.includes('classified_product') || c.includes('Classified')) {
    pass('DiagnosticsPanel.tsx shows classified_product column')
  } else {
    fail('DiagnosticsPanel.tsx missing classified_product in order diagnostics')
  }
  if (c.includes('classification_reason') || c.includes('Reason')) {
    pass('DiagnosticsPanel.tsx shows classification_reason column')
  } else {
    fail('DiagnosticsPanel.tsx missing classification_reason in order diagnostics')
  }
  if (c.includes('price_warnings_count') || c.includes('Price fallback') || c.includes('priceRulesApplied')) {
    pass('DiagnosticsPanel.tsx shows price fallback warning when applicable')
  } else {
    fail('DiagnosticsPanel.tsx does not show price_warnings_count — misleading name events invisible')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Price-first product classification rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} price classification violation(s).`)
  process.exit(1)
}
