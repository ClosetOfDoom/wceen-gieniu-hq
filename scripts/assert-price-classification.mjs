#!/usr/bin/env node
// Assert WCEEN absolute product price classification rules.
// 549 PLN = JSU_COURSE | 347 PLN = JZK_LANGUAGE | 119 PLN = MEMORY_PACK
// These are absolute business rules — no keyword checks required.
// UNKNOWN_PRICE_347 must not exist.

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

// 1. productClassifier.ts — absolute rules, no UNKNOWN_PRICE_347
if (!exists('src/lib/productClassifier.ts')) {
  fail('src/lib/productClassifier.ts does not exist')
} else {
  const c = read('src/lib/productClassifier.ts')

  if (c.includes('UNKNOWN_PRICE_347')) {
    fail('productClassifier.ts still contains UNKNOWN_PRICE_347 — must be removed (347 PLN is always JZK_LANGUAGE)')
  } else {
    pass('productClassifier.ts does not contain UNKNOWN_PRICE_347 (correct)')
  }

  if (c.includes('classifyByPrice')) {
    pass('productClassifier.ts exports classifyByPrice()')
  } else {
    fail('productClassifier.ts missing classifyByPrice()')
  }

  if (c.includes('absolute price rule: 549') || (c.includes('549') && c.includes('JSU_COURSE'))) {
    pass('productClassifier.ts has absolute 549 PLN → JSU_COURSE rule')
  } else {
    fail('productClassifier.ts missing absolute 549 PLN = JSU rule')
  }

  if (c.includes('absolute price rule: 347') || (c.includes('347') && c.includes('JZK_LANGUAGE'))) {
    pass('productClassifier.ts has absolute 347 PLN → JZK_LANGUAGE rule')
  } else {
    fail('productClassifier.ts missing absolute 347 PLN = JZK rule')
  }

  if (c.includes('absolute price rule: 119') || (c.includes('119') && c.includes('MEMORY_PACK'))) {
    pass('productClassifier.ts has absolute 119 PLN → MEMORY_PACK rule')
  } else {
    fail('productClassifier.ts missing absolute 119 PLN = memory pack rule')
  }

  // 347 PLN must not require language keywords
  if (c.includes('amount === 347') && !c.includes('UNKNOWN_PRICE_347')) {
    pass('productClassifier.ts classifies 347 PLN as JZK_LANGUAGE without requiring language keywords')
  } else if (c.includes('amount === 347')) {
    fail('productClassifier.ts still routes 347 PLN to UNKNOWN — must be JZK_LANGUAGE unconditionally')
  }

  if (c.includes('maskEmail')) {
    pass('productClassifier.ts exports maskEmail()')
  } else {
    fail('productClassifier.ts missing maskEmail()')
  }

  if (c.includes('PRODUCT_CLASSIFICATION_AVAILABLE = false')) {
    pass('productClassifier.ts keeps PRODUCT_CLASSIFICATION_AVAILABLE = false (price classification is backend-only)')
  } else {
    fail('productClassifier.ts should keep PRODUCT_CLASSIFICATION_AVAILABLE = false')
  }
}

// 2. Live classification test via scheduleUtils.js (for import machinery) + static ops-week-report checks
try {
  const utilsPath = pathToFileURL(join(rootDir, 'netlify/functions/scheduleUtils.js')).href
  await import(utilsPath)

  const c = read('netlify/functions/ops-week-report.js')

  // 549 PLN → JSU_COURSE (absolute, no keyword requirement)
  if (c.includes('amount === 549') && c.includes('JSU_COURSE')) {
    pass('ops-week-report.js classifies 549 PLN → JSU_COURSE (absolute)')
  } else {
    fail('ops-week-report.js missing 549 PLN → JSU_COURSE absolute rule')
  }

  // 347 PLN → JZK_LANGUAGE (absolute, no keyword requirement)
  if (c.includes('amount === 347') && c.includes('JZK_LANGUAGE')) {
    pass('ops-week-report.js classifies 347 PLN → JZK_LANGUAGE (absolute)')
  } else {
    fail('ops-week-report.js missing absolute 347 PLN = JZK rule')
  }

  // 347 PLN must NOT route to UNKNOWN_PRICE_347
  if (c.includes('UNKNOWN_PRICE_347')) {
    fail('ops-week-report.js still contains UNKNOWN_PRICE_347 — must be removed')
  } else {
    pass('ops-week-report.js does not contain UNKNOWN_PRICE_347 (correct)')
  }

  // 119 PLN → MEMORY_PACK (absolute)
  if (c.includes('amount === 119') && c.includes('MEMORY_PACK')) {
    pass('ops-week-report.js classifies 119 PLN → MEMORY_PACK (absolute)')
  } else {
    fail('ops-week-report.js missing 119 PLN = memory pack rule')
  }

  // Reason strings must say "absolute price rule"
  if (c.includes('absolute price rule')) {
    pass('ops-week-report.js uses "absolute price rule" in classification reason strings')
  } else {
    fail('ops-week-report.js should say "absolute price rule" in reason strings')
  }

  // Warning when product_name_raw contradicts price rule
  if (c.includes('Wix product_name_raw is misleading') || c.includes('Price rule used')) {
    pass('ops-week-report.js warns when product_name_raw contradicts price rule')
  } else {
    fail('ops-week-report.js does not warn when Wix name contradicts price — silent misclassification invisible')
  }

} catch (e) {
  fail(`Could not run ops-week-report.js classification tests: ${e.message}`)
}

// 3. ops-week-report.js infrastructure
if (!exists('netlify/functions/ops-week-report.js')) {
  fail('netlify/functions/ops-week-report.js does not exist')
} else {
  const c = read('netlify/functions/ops-week-report.js')
  if (c.includes('extractAmount')) {
    pass('ops-week-report.js has extractAmount()')
  } else {
    fail('ops-week-report.js missing extractAmount()')
  }
  if (c.includes('order_diagnostics')) {
    pass('ops-week-report.js builds and returns order_diagnostics array')
  } else {
    fail('ops-week-report.js missing order_diagnostics')
  }
  if (c.includes('email_masked')) {
    pass('ops-week-report.js masks emails in order_diagnostics')
  } else {
    fail('ops-week-report.js must mask emails (email_masked field)')
  }
  if (c.includes('price_warnings_count')) {
    pass('ops-week-report.js tracks price_warnings_count')
  } else {
    fail('ops-week-report.js missing price_warnings_count')
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
  if (c.includes('order_diagnostics') && c.includes('price_warnings_count')) {
    pass('opsWeekReport.ts has order_diagnostics + price_warnings_count in OpsWeekOrders')
  } else {
    fail('opsWeekReport.ts missing order_diagnostics or price_warnings_count')
  }
}

// 5. responses.ts — correct labels and builders
if (!exists('src/brain/responses.ts')) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = read('src/brain/responses.ts')

  if (c.includes('JSU course sold') || (c.includes('JSU course') && c.includes('549'))) {
    pass('responses.ts uses "JSU course sold" label for 549 PLN orders')
  } else {
    fail('responses.ts must say "JSU course sold" (549 PLN) for JSU orders')
  }

  if (c.includes('buildJzkSalesAnswer')) {
    pass('responses.ts has buildJzkSalesAnswer() for JZK order count')
  } else {
    fail('responses.ts missing buildJzkSalesAnswer() — "ile zeszło Językozaka" has no answer')
  }

  if (c.includes('buildJzkSalesSpoken')) {
    pass('responses.ts has buildJzkSalesSpoken()')
  } else {
    fail('responses.ts missing buildJzkSalesSpoken()')
  }

  // JZK sales answer must reference 347 PLN
  if (c.includes('347 PLN') || c.includes('347')) {
    pass('responses.ts JZK sales answer references 347 PLN price rule')
  } else {
    fail('responses.ts JZK sales answer does not reference 347 PLN — unclear what orders are counted')
  }

  if (c.includes('price_warnings_count') || c.includes('price fallback')) {
    pass('responses.ts shows price fallback warning when applicable')
  } else {
    fail('responses.ts does not mention price fallback warning')
  }
}

// 6. intent.ts — jzk_sales_query intent
if (!exists('src/brain/intent.ts')) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = read('src/brain/intent.ts')

  if (c.includes('jzk_sales_query') && c.includes('buildJzkSalesAnswer')) {
    pass('intent.ts has jzk_sales_query intent using buildJzkSalesAnswer()')
  } else {
    fail('intent.ts missing jzk_sales_query intent — "ile zeszło Językozaka" has no route')
  }

  if (c.includes('ile zeszlo jezykozaka') || c.includes('ile zeszlo jzk') || c.includes('ile jezykozakow')) {
    pass('intent.ts recognizes "ile zeszło Językozaka" / "ile zeszło JZK" queries')
  } else {
    fail('intent.ts missing JZK sales trigger phrases')
  }

  // jzk_sales_query must be BEFORE jzk_week_report (both catch 'jezykozak')
  const salesIdx   = c.indexOf('jzk_sales_query')
  const weekIdx    = c.indexOf('jzk_week_report')
  if (salesIdx > 0 && weekIdx > 0 && salesIdx < weekIdx) {
    pass('jzk_sales_query handler is positioned BEFORE jzk_week_report (correct priority)')
  } else {
    fail('jzk_sales_query must be BEFORE jzk_week_report — otherwise "ile zeszło JZK" routes to week report')
  }

  if (c.includes('ile zeszlo jsu') || c.includes('ile kursow jsu')) {
    pass('intent.ts recognizes "ile zeszło JSU" (549 PLN) queries')
  } else {
    fail('intent.ts missing "ile zeszło JSU" trigger phrases')
  }
}

// 7. DiagnosticsPanel shows order diagnostics table and price warnings
if (!exists('src/components/DiagnosticsPanel.tsx')) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = read('src/components/DiagnosticsPanel.tsx')
  if (c.includes('order_diagnostics') || c.includes('Order Classification')) {
    pass('DiagnosticsPanel.tsx shows order diagnostics table')
  } else {
    fail('DiagnosticsPanel.tsx missing order diagnostics table')
  }
  if (c.includes('price_warnings_count') || c.includes('Price fallback')) {
    pass('DiagnosticsPanel.tsx shows price fallback warning row')
  } else {
    fail('DiagnosticsPanel.tsx missing price_warnings_count row')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Absolute price classification rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} price classification violation(s).`)
  process.exit(1)
}
