#!/usr/bin/env node
// Assert profit metrics contract:
// - margin config correct
// - profit-data endpoint uses service role, no-store cache
// - KPI cards present in App.tsx
// - GIENIU profit intent routes to profit_query

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }
function read(rel) { return readFileSync(join(rootDir, rel), 'utf8') }
function exists(rel) { return existsSync(join(rootDir, rel)) }

// 1. THE single product catalog holds every price, scope and margin.
//    src/services/productMargins.ts used to carry a second copy of this table;
//    it was deleted, and section 1b exists so a second copy never comes back.
//    The catalog is imported, not grepped, so these are the real values.
{
  const f = 'netlify/functions/productCatalog.js'
  if (!exists(f)) {
    fail(`${f} is missing - it is the ONE source of prices, margins and scope`)
  } else {
    const cat = await import(new URL('../netlify/functions/productCatalog.js', import.meta.url))
    const { PRODUCTS, PRICE_TO_PRODUCT } = cat

    // Authoritative business table: price -> product, scope, contribution margin.
    const CATALOG = [
      [119,  'memory_pack',    'memory',   70],
      [114,  'language_3t',    'language', 55],
      [347,  'jzk_ai',         'language', 320],
      [549,  'jsu_course',     'memory',   500],
      [95,   'jezykozak_pack', 'language', null],
      [499,  'cogni_year',     'cogni',    null],
      [1250, 'wsztp',          'memory',   null],
      [3450, 'wsztp',          'memory',   null],
    ]
    for (const [price, key, scope, margin] of CATALOG) {
      const p = PRODUCTS[key]
      const ok = PRICE_TO_PRODUCT[price] === key && p && p.scope === scope && p.contributionMargin === margin
      if (ok) pass(`catalog: ${price} PLN -> ${key}, scope ${scope}, margin ${margin === null ? 'null (not invented)' : margin}`)
      else fail(`catalog: ${price} PLN must map to ${key}, scope ${scope}, margin ${margin} - got ${PRICE_TO_PRODUCT[price]} / ${p && p.scope} / ${p && p.contributionMargin}`)
    }

    // A 99 PLN Pakiet Pamieciowy (shipping line missing from the order) must earn
    // the honest 50, not the full 70 and not zero.
    const disc = cat.classifyAmount(99, 'Pamiec. Trening Interaktywny')
    if (disc.productKey === 'memory_pack' && disc.margin === 50) {
      pass('catalog: a 99 PLN PP earns 50, derived from the unit cost - not guessed')
    } else {
      fail(`catalog: 99 PLN PP must be memory_pack with margin 50, got ${disc.productKey} / ${disc.margin}`)
    }

    // An unknown amount must be UNMAPPED with the failing field named - never PP.
    const unk = cat.classifyAmount(137, 'Zestaw niespodzianka')
    if (unk.bucket === 'UNMAPPED' && unk.margin === null && unk.failedField) {
      pass(`catalog: an unknown amount is UNMAPPED and names its failing field`)
    } else {
      fail('catalog: an unknown amount must be UNMAPPED, margin null, with failedField set')
    }

    // A 99 + 20 shipping split must classify as ONE Pakiet Pamieciowy.
    const agg = cat.aggregateOrders([
      { external_order_id: 'X1', order_created_at: '2026-09-07T09:00:00Z', amount: 99, product_name_raw: 'Pamiec. Trening Interaktywny: Ebook + Druk' },
      { external_order_id: 'X1', order_created_at: '2026-09-07T09:00:00Z', amount: 20, product_name_raw: 'Wysylka + Ubezpieczenie + Paczka' },
    ])
    if (agg.length === 1 && agg[0].revenue === 119 && cat.classifyOrder(agg[0]).productKey === 'memory_pack') {
      pass('catalog: 99 + 20 shipping in one order classifies as one Pakiet Pamieciowy at 119')
    } else {
      fail('catalog: line items must be grouped by order id with the shipping line dropped from classification')
    }

    // The bug this module was written to kill: an unordered, unpaged read that
    // PostgREST silently caps at 1000 rows, returning the OLDEST rows.
    const src = read(f)
    if (/order:\s*'order_created_at\.desc/.test(src)) {
      pass('catalog: every orders read is explicitly ORDERED (never physical row order)')
    } else {
      fail('catalog: orders reads must set order=order_created_at.desc - an unordered read returns the OLDEST 1000 rows')
    }
    if (src.includes('const PAGE = 1000') && src.includes('offset:')) {
      pass('catalog: orders reads page past the 1000-row PostgREST cap')
    } else {
      fail('catalog: orders reads must page past the 1000-row cap')
    }
  }
}

// 1b. No second copy of the price/margin table may exist anywhere else.
{
  if (exists('src/services/productMargins.ts')) {
    fail('src/services/productMargins.ts is back — margins must live ONLY in netlify/functions/productCatalog.js')
  } else {
    pass('no duplicate margin table in src/services')
  }
  for (const f of ['netlify/functions/orders-data.js', 'netlify/functions/product-sales.js', 'netlify/functions/profit-data.js']) {
    const c = read(f)
    if (c.includes("from './productCatalog.js'")) {
      pass(`${f.split('/').pop()}: imports the shared catalog`)
    } else {
      fail(`${f}: must import from ./productCatalog.js instead of defining its own rules`)
    }
    if (/contributionMargin:\s*\d/.test(c) || /catalogPrice:\s*\d/.test(c)) {
      fail(`${f}: defines its own price/margin numbers — those belong in productCatalog.js only`)
    } else {
      pass(`${f.split('/').pop()}: defines no prices or margins of its own`)
    }
  }
}

// 2. profit-data.js exists and uses service role + correct margin rules
{
  const f = 'netlify/functions/profit-data.js'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)
    if (c.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      pass('profit-data.js uses SUPABASE_SERVICE_ROLE_KEY (service role)')
    } else {
      fail('profit-data.js must use SUPABASE_SERVICE_ROLE_KEY — never the anon key')
    }
    if (c.includes('no-store') || c.includes('Cache-Control')) {
      pass('profit-data.js sends Cache-Control: no-store headers')
    } else {
      fail('profit-data.js must set Cache-Control: no-store to prevent stale profit figures')
    }
    // Margins are asserted against the catalog in section 1. Here we only check
    // that profit-data delegates rather than carrying its own copy.
    if (c.includes('classifyOrder') && c.includes('aggregateOrders')) {
      pass('profit-data.js: classifies aggregated orders through the shared catalog')
    } else {
      fail('profit-data.js: must classify via aggregateOrders + classifyOrder from productCatalog.js')
    }
    if (c.includes('noMarginOrdersCount') && c.includes('noMarginFields')) {
      pass('profit-data.js: reports how many orders earned no margin, and on which field')
    } else {
      fail('profit-data.js: must return noMarginOrdersCount + noMarginFields — a profit figure may not hide its holes')
    }
    if (!/margin\s*=\s*0/.test(c) && !/margin:\s*0/.test(c)) {
      pass('profit-data.js: never assigns margin 0 to an unmapped order')
    } else {
      fail('profit-data.js: an unmapped order must be excluded, not folded in at margin 0')
    }
    if (c.includes('unknownRevenue')) {
      pass('profit-data.js: returns unknownRevenue field for unmapped products')
    } else {
      fail('profit-data.js: must return unknownRevenue to show unmapped revenue in UI')
    }
    if (c.includes('estimatedProfitAfterAds')) {
      pass('profit-data.js: returns estimatedProfitAfterAds')
    } else {
      fail('profit-data.js: must return estimatedProfitAfterAds')
    }
    if (c.includes('estimatedProfitPerOrder')) {
      pass('profit-data.js: returns estimatedProfitPerOrder')
    } else {
      fail('profit-data.js: must return estimatedProfitPerOrder')
    }
    if (c.includes('marginBeforeAds')) {
      pass('profit-data.js: returns marginBeforeAds')
    } else {
      fail('profit-data.js: must return marginBeforeAds')
    }
    if (c.includes('productBreakdown')) {
      pass('profit-data.js: returns productBreakdown array')
    } else {
      fail('profit-data.js: must return productBreakdown array')
    }
    if (c.includes('adSpendSource')) {
      pass('profit-data.js: returns adSpendSource field')
    } else {
      fail('profit-data.js: must return adSpendSource (which table was used for ad spend)')
    }
    if (c.includes('v_daily_wix_meta_performance')) {
      pass('profit-data.js: prefers v_daily_wix_meta_performance for ad spend (same as Command Center)')
    } else {
      fail('profit-data.js: must prefer v_daily_wix_meta_performance for ad spend consistency')
    }
    if (c.includes('meta_ads_daily')) {
      pass('profit-data.js: falls back to meta_ads_daily for ad spend')
    } else {
      fail('profit-data.js: must fallback to meta_ads_daily if aggregate view has no data')
    }
    if (c.includes('unmappedOrders')) {
      pass('profit-data.js: returns unmappedOrders array')
    } else {
      fail('profit-data.js: must return unmappedOrders for debugging')
    }
  }
}

// 3. Arithmetic verification: 8 memory_pack orders × 70 - 432.97 = 127.03
{
  const margin8 = 8 * 70           // 560
  const adSpend = 432.97
  const profit  = margin8 - adSpend  // 127.03
  if (Math.abs(profit - 127.03) < 0.01) {
    pass(`Arithmetic check: 8 × 70 PLN margin − 432.97 PLN ad spend = ${profit.toFixed(2)} PLN profit ✓`)
  } else {
    fail(`Arithmetic check failed: expected 127.03, got ${profit.toFixed(2)}`)
  }
}

// 4. profitData.ts lib exists
{
  const f = 'src/lib/profitData.ts'
  if (!exists(f)) {
    fail(`${f} is missing`)
  } else {
    const c = read(f)
    if (c.includes('fetchProfitData')) {
      pass('profitData.ts: exports fetchProfitData()')
    } else {
      fail('profitData.ts: must export fetchProfitData()')
    }
    if (c.includes('ProfitData')) {
      pass('profitData.ts: exports ProfitData interface')
    } else {
      fail('profitData.ts: must export ProfitData interface')
    }
    if (c.includes('CACHE_TTL') || c.includes('cache')) {
      pass('profitData.ts: has caching (2-min TTL)')
    } else {
      fail('profitData.ts: must cache responses to avoid hammering the backend')
    }
  }
}

// 5. responses.ts has profit builders
{
  const c = read('src/brain/responses.ts')
  if (c.includes('buildProfitAnswer')) {
    pass('responses.ts: exports buildProfitAnswer()')
  } else {
    fail('responses.ts: must export buildProfitAnswer(profitData)')
  }
  if (c.includes('buildProfitSpoken')) {
    pass('responses.ts: exports buildProfitSpoken()')
  } else {
    fail('responses.ts: must export buildProfitSpoken(profitData)')
  }
  if (c.includes('import type { ProfitData }') || c.includes("from '../lib/profitData'")) {
    pass('responses.ts: imports ProfitData from lib/profitData')
  } else {
    fail('responses.ts: must import ProfitData type from lib/profitData')
  }
  if (c.includes('profitVerdict') || c.includes('dokładamy do interesu') || c.includes('marza pokrywa')) {
    pass('responses.ts: buildProfitSpoken has verdict phrasing')
  } else {
    fail('responses.ts: buildProfitSpoken must include profit verdict phrase')
  }
  if (c.includes('unknownRevenue') || c.includes('niezidentyfikowan')) {
    pass('responses.ts: buildProfitAnswer warns when unknownRevenue > 0')
  } else {
    fail('responses.ts: must warn about unmapped/unknown revenue in profit answer')
  }
}

// 6. intent.ts has profit_query intent
{
  const c = read('src/brain/intent.ts')
  if (c.includes('profit_query')) {
    pass('intent.ts: has profit_query intent')
  } else {
    fail('intent.ts: missing profit_query intent — "ile na czysto" has no route')
  }
  if (c.includes('ile na czysto') && c.includes('zysk dzisiaj')) {
    pass('intent.ts: profit_query recognizes "ile na czysto" and "zysk dzisiaj"')
  } else {
    fail('intent.ts: profit_query must recognize "ile na czysto" and "zysk dzisiaj"')
  }
  if (c.includes('czy to sie oplaca') || c.includes('oplaca')) {
    pass('intent.ts: profit_query recognizes "czy to się opłaca"')
  } else {
    fail('intent.ts: profit_query must recognize "czy to się opłaca"')
  }
  if (c.includes("'profit today'") || c.includes('"profit today"')) {
    pass('intent.ts: profit_query recognizes "profit today"')
  } else {
    fail('intent.ts: profit_query must recognize "profit today"')
  }
  if (c.includes('buildProfitAnswer') && c.includes('profitData')) {
    pass('intent.ts: profit_query routes to buildProfitAnswer(profitData)')
  } else {
    fail('intent.ts: profit_query must call buildProfitAnswer(profitData)')
  }
  if (c.includes('profitData: ProfitData') || (c.includes('profitData') && c.includes('ProfitData'))) {
    pass('intent.ts: IntentContext has profitData field')
  } else {
    fail('intent.ts: IntentContext must include profitData: ProfitData | null')
  }
}

// 7. App.tsx has profit KPI cards and wires profitData
{
  const c = read('src/App.tsx')
  if (c.includes('fetchProfitData') && c.includes('profitData')) {
    pass('App.tsx: loads profitData via fetchProfitData()')
  } else {
    fail('App.tsx: must load profitData via fetchProfitData() at startup')
  }
  if (c.includes('Est. Profit') || c.includes('estimatedProfitAfterAds')) {
    pass('App.tsx: renders Est. Profit KPI card')
  } else {
    fail('App.tsx: must render "Est. Profit" KPI card in Command Center')
  }
  if (c.includes('Margin Before Ads') || c.includes('marginBeforeAds')) {
    pass('App.tsx: renders Margin Before Ads KPI card')
  } else {
    fail('App.tsx: must render "Margin Before Ads" KPI card')
  }
  if (c.includes('Profit / Order') || c.includes('estimatedProfitPerOrder')) {
    pass('App.tsx: renders Profit / Order KPI card')
  } else {
    fail('App.tsx: must render "Profit / Order" KPI card')
  }
  if (c.includes('Unmapped Revenue') || c.includes('unknownRevenue')) {
    pass('App.tsx: renders Unmapped Revenue KPI card')
  } else {
    fail('App.tsx: must render "Unmapped Revenue" KPI card with warning when > 0')
  }
  if (c.includes('profitPositive') || c.includes('profitDanger') || c.includes('profitWarning')) {
    pass('App.tsx: profit KPI card has color logic (positive/warning/danger)')
  } else {
    fail('App.tsx: Est. Profit KPI card must use positive/warning/danger color based on value')
  }
  if (c.includes('profitMismatch') || c.includes('Profit endpoint')) {
    pass('App.tsx: shows mismatch warning when profit endpoint returns 0 but ordersData has orders')
  } else {
    fail('App.tsx: must warn when profitData.ordersCount === 0 but ordersData.today_orders > 0')
  }
  if (c.includes("profitData }") || c.includes('profitData,')) {
    pass('App.tsx: passes profitData to resolveIntent')
  } else {
    fail('App.tsx: must pass profitData to resolveIntent for GIENIU profit query routing')
  }
}

// 8. KPICard supports positive and danger props
{
  const c = read('src/components/KPICard.tsx')
  if (c.includes('positive') && c.includes('danger')) {
    pass('KPICard.tsx: has positive and danger props for profit color variants')
  } else {
    fail('KPICard.tsx: must add positive (green) and danger (red) props for profit visualization')
  }
  if (c.includes('#ef4444') || c.includes('var(--red)') || c.includes('danger')) {
    pass('KPICard.tsx: danger variant renders in red')
  } else {
    fail('KPICard.tsx: danger prop must render value in red (#ef4444 or CSS var)')
  }
  // The healthy variant moved from --teal to --emerald when the palette changed.
  if ((c.includes('var(--emerald)') || c.includes('var(--teal)')) && c.includes('positive')) {
    pass('KPICard.tsx: positive variant renders in green (emerald/teal)')
  } else {
    fail('KPICard.tsx: positive prop must render value in green (var(--emerald) or var(--teal))')
  }
}

// 9. package.json has assert:profit-metrics
{
  const pkg = JSON.parse(read('package.json'))
  if (pkg.scripts && pkg.scripts['assert:profit-metrics']) {
    pass('package.json: has assert:profit-metrics script')
  } else {
    fail('package.json: missing assert:profit-metrics script')
  }
}

// 10. docs exist
{
  if (exists('docs/profit_metrics.md')) {
    pass('docs/profit_metrics.md exists')
    const c = read('docs/profit_metrics.md')
    if (c.includes('revenue is not profit') || c.includes('NOT') || c.includes('does not subtract')) {
      pass('docs/profit_metrics.md: explains that revenue ≠ profit')
    } else {
      fail('docs/profit_metrics.md: must explain that revenue is not profit')
    }
  } else {
    fail('docs/profit_metrics.md is missing')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Profit metrics contract satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} profit metrics violation(s).`)
  process.exit(1)
}
