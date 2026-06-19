#!/usr/bin/env node
// Assert WCEEN fixed weekly schedule classification rules.
// Thursday 18:00 Warsaw = JSU | Tuesday 18:00 Warsaw = JZK
// product_tag from DB is LAST RESORT, not primary.

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

// 1. webinarSchedule.ts exists with correct structure
if (!exists('src/lib/webinarSchedule.ts')) {
  fail('src/lib/webinarSchedule.ts does not exist')
} else {
  const c = read('src/lib/webinarSchedule.ts')
  if (c.includes('classifyWebinarBySchedule')) {
    pass('webinarSchedule.ts exports classifyWebinarBySchedule')
  } else {
    fail('webinarSchedule.ts missing classifyWebinarBySchedule export')
  }
  if (c.includes('Thursday') && c.includes('18')) {
    pass('webinarSchedule.ts has Thursday 18 → JSU rule')
  } else {
    fail('webinarSchedule.ts missing Thursday 18:00 → JSU rule')
  }
  if (c.includes('Tuesday') && c.includes('18')) {
    pass('webinarSchedule.ts has Tuesday 18 → JZK rule')
  } else {
    fail('webinarSchedule.ts missing Tuesday 18:00 → JZK rule')
  }
  if (c.includes('Europe/Warsaw')) {
    pass('webinarSchedule.ts uses Europe/Warsaw timezone for conversion')
  } else {
    fail('webinarSchedule.ts does not use Europe/Warsaw — UTC timestamps will not be converted correctly')
  }
  if (c.includes('Intl.DateTimeFormat') || c.includes('formatToParts')) {
    pass('webinarSchedule.ts uses Intl.DateTimeFormat for UTC→Warsaw conversion')
  } else {
    fail('webinarSchedule.ts not using Intl.DateTimeFormat — timezone conversion may be wrong')
  }
  if (c.includes('product_tag') && c.includes('last resort')) {
    pass('webinarSchedule.ts marks product_tag as last resort (not primary)')
  } else {
    fail('webinarSchedule.ts does not clearly mark product_tag as last resort')
  }
  if (c.includes('fixed schedule: Thursday')) {
    pass('webinarSchedule.ts reason string says "fixed schedule: Thursday"')
  } else {
    fail('webinarSchedule.ts reason string should say "fixed schedule: Thursday 18:00 Warsaw"')
  }
  if (c.includes('fixed schedule: Tuesday')) {
    pass('webinarSchedule.ts reason string says "fixed schedule: Tuesday"')
  } else {
    fail('webinarSchedule.ts reason string should say "fixed schedule: Tuesday 18:00 Warsaw"')
  }
}

// 2. Live classification test — load and run the module
const schedulePath = join(rootDir, 'src/lib/webinarSchedule.ts')
try {
  // Try to import the JS equivalent via scheduleUtils.js (plain JS, can be imported directly)
  const utilsPath = pathToFileURL(join(rootDir, 'netlify/functions/scheduleUtils.js')).href
  const { classifyBySchedule } = await import(utilsPath)

  // Thursday 18:00 Warsaw in June (UTC+2) = 16:00 UTC — June 18 2026 is Thursday
  const thursdayUtc = '2026-06-18T16:00:00Z' // Thu 18 Jun 2026 = 18:00 Warsaw (UTC+2)
  const thursdayResult = classifyBySchedule({ scheduled_at: thursdayUtc, session_name: 'Test session', product_tag: 'jzk' })
  if (thursdayResult.product_tag === 'JSU') {
    pass(`Thursday 18:00 UTC+2 (${thursdayUtc}) → JSU (correct, ignores product_tag=jzk)`)
  } else {
    fail(`Thursday 18:00 UTC+2 (${thursdayUtc}) → ${thursdayResult.product_tag} (expected JSU). Reason: ${thursdayResult.reason}`)
  }

  // Tuesday 18:00 Warsaw in June (UTC+2) = 16:00 UTC
  const tuesdayUtc = '2026-06-16T16:00:00Z' // Tue 18:00 Warsaw
  const tuesdayResult = classifyBySchedule({ scheduled_at: tuesdayUtc, session_name: 'Test session', product_tag: 'jsu' })
  if (tuesdayResult.product_tag === 'JZK') {
    pass(`Tuesday 18:00 UTC+2 (${tuesdayUtc}) → JZK (correct, ignores product_tag=jsu)`)
  } else {
    fail(`Tuesday 18:00 UTC+2 (${tuesdayUtc}) → ${tuesdayResult.product_tag} (expected JZK). Reason: ${tuesdayResult.reason}`)
  }

  // Wrong time — should not classify as JSU/JZK by schedule alone
  const wednesdayUtc = '2026-06-17T16:00:00Z' // Wed 18:00 Warsaw
  const wednesdayResult = classifyBySchedule({ scheduled_at: wednesdayUtc, session_name: 'pamiec test', product_tag: null })
  if (wednesdayResult.product_tag !== 'JSU' || !wednesdayResult.reason.includes('session_name')) {
    // Either OTHER or JSU from name fallback, but NOT from schedule
    if (wednesdayResult.reason.includes('fixed schedule')) {
      fail(`Wednesday should not match "fixed schedule" rule (got: ${wednesdayResult.reason})`)
    } else {
      pass(`Wednesday 18:00 does not trigger fixed schedule rule (falls back to: ${wednesdayResult.reason})`)
    }
  } else {
    pass(`Wednesday classified by name fallback, not schedule (reason: ${wednesdayResult.reason})`)
  }

  // product_tag override: Thursday session with product_tag=JZK must still be JSU (schedule wins)
  const overrideResult = classifyBySchedule({ scheduled_at: thursdayUtc, session_name: 'some session', product_tag: 'JZK' })
  if (overrideResult.product_tag === 'JSU') {
    pass('Thursday 18:00 with product_tag=JZK → correctly classified as JSU (schedule wins)')
  } else {
    fail(`Thursday 18:00 with product_tag=JZK → ${overrideResult.product_tag} (schedule should win over product_tag)`)
  }

  // Tuesday session with product_tag=JSU must be JZK
  const overrideTueResult = classifyBySchedule({ scheduled_at: tuesdayUtc, session_name: 'some session', product_tag: 'JSU' })
  if (overrideTueResult.product_tag === 'JZK') {
    pass('Tuesday 18:00 with product_tag=JSU → correctly classified as JZK (schedule wins)')
  } else {
    fail(`Tuesday 18:00 with product_tag=JSU → ${overrideTueResult.product_tag} (schedule should win over product_tag)`)
  }

} catch (e) {
  fail(`Could not load scheduleUtils.js for live testing: ${e.message}`)
}

// 3. scheduleUtils.js exists (shared backend module)
if (!exists('netlify/functions/scheduleUtils.js')) {
  fail('netlify/functions/scheduleUtils.js does not exist')
} else {
  const c = read('netlify/functions/scheduleUtils.js')
  if (c.includes('classifyBySchedule')) {
    pass('scheduleUtils.js exports classifyBySchedule')
  } else {
    fail('scheduleUtils.js missing classifyBySchedule export')
  }
  if (c.includes('Thursday') && c.includes('Tuesday')) {
    pass('scheduleUtils.js has both Thursday and Tuesday rules')
  } else {
    fail('scheduleUtils.js missing Thursday or Tuesday schedule rule')
  }
  if (c.includes('Europe/Warsaw')) {
    pass('scheduleUtils.js uses Europe/Warsaw timezone')
  } else {
    fail('scheduleUtils.js does not use Europe/Warsaw timezone')
  }
}

// 4. webinar-data.js uses schedule classifier
if (!exists('netlify/functions/webinar-data.js')) {
  fail('netlify/functions/webinar-data.js does not exist')
} else {
  const c = read('netlify/functions/webinar-data.js')
  if (c.includes('scheduleUtils') || c.includes('classifyBySchedule')) {
    pass('webinar-data.js imports and uses schedule classifier')
  } else {
    fail('webinar-data.js does not use schedule classifier — sessions classified by product_tag only')
  }
  if (c.includes('product_tag_schedule') || c.includes('schedule_reason')) {
    pass('webinar-data.js adds schedule classification fields to session response')
  } else {
    fail('webinar-data.js does not add schedule classification fields to session response')
  }
}

// 5. ops-week-report.js uses schedule classifier
if (!exists('netlify/functions/ops-week-report.js')) {
  fail('netlify/functions/ops-week-report.js does not exist')
} else {
  const c = read('netlify/functions/ops-week-report.js')
  if (c.includes('scheduleUtils') || c.includes('classifyBySchedule')) {
    pass('ops-week-report.js uses schedule classifier')
  } else {
    fail('ops-week-report.js does not use schedule classifier')
  }
  if (c.includes('jzk_sessions') && c.includes('jzk_participants')) {
    pass('ops-week-report.js tracks JZK sessions and participants separately from JSU')
  } else {
    fail('ops-week-report.js missing jzk_sessions / jzk_participants tracking')
  }
  // Must not use isJsuSession based on product_tag patterns — now delegates to schedule
  const hasScheduleDelegate = c.includes('classifyBySchedule') || c.includes('scheduleUtils')
  if (hasScheduleDelegate) {
    pass('ops-week-report.js isJsuSession delegates to schedule classifier')
  }
}

// 6. webinarProduct.ts uses schedule as primary when scheduled_at available
if (!exists('src/lib/webinarProduct.ts')) {
  fail('src/lib/webinarProduct.ts does not exist')
} else {
  const c = read('src/lib/webinarProduct.ts')
  if (c.includes('classifyWebinarBySchedule') || c.includes('webinarSchedule')) {
    pass('webinarProduct.ts imports and uses webinarSchedule as primary classifier')
  } else {
    fail('webinarProduct.ts does not use webinarSchedule — session_name may override schedule incorrectly')
  }
  if (c.includes('scheduled_at')) {
    pass('webinarProduct.ts normalizeProduct accepts scheduled_at parameter')
  } else {
    fail('webinarProduct.ts normalizeProduct does not accept scheduled_at — schedule classifier unreachable from UI')
  }
}

// 7. WebinarFunnelPanel uses schedule classification
if (!exists('src/components/WebinarFunnelPanel.tsx')) {
  fail('src/components/WebinarFunnelPanel.tsx does not exist')
} else {
  const c = read('src/components/WebinarFunnelPanel.tsx')
  if (c.includes('classifyWebinarBySchedule') || c.includes('webinarSchedule')) {
    pass('WebinarFunnelPanel.tsx uses schedule classifier for session display')
  } else {
    fail('WebinarFunnelPanel.tsx does not use schedule classifier — product tabs may show wrong counts')
  }
  if (c.includes('scheduled_at: s.scheduled_at') || c.includes('scheduled_at: s.session')) {
    pass('WebinarFunnelPanel.tsx passes scheduled_at to classifier for each session')
  } else {
    fail('WebinarFunnelPanel.tsx does not pass scheduled_at to classifier — UTC timestamps not converted')
  }
  if (c.includes('Thu 18:00') || c.includes('Thursday 18:00') || (c.includes('Thu') && c.includes('JSU'))) {
    pass('WebinarFunnelPanel.tsx shows schedule rule note in UI')
  } else {
    fail('WebinarFunnelPanel.tsx missing schedule rule note (Tue 18:00=JZK · Thu 18:00=JSU)')
  }
  if (c.includes('JZK / Językozak') || c.includes('JSU / Memory')) {
    pass('WebinarFunnelPanel.tsx has separate JSU and JZK cards')
  } else {
    fail('WebinarFunnelPanel.tsx missing separate JSU/JZK per-product cards')
  }
}

// 8. responses.ts has JZK builders
if (!exists('src/brain/responses.ts')) {
  fail('src/brain/responses.ts does not exist')
} else {
  const c = read('src/brain/responses.ts')
  if (c.includes('buildJzkWeekReport')) {
    pass('responses.ts has buildJzkWeekReport()')
  } else {
    fail('responses.ts missing buildJzkWeekReport()')
  }
  if (c.includes('buildJzkWeekReportSpoken')) {
    pass('responses.ts has buildJzkWeekReportSpoken()')
  } else {
    fail('responses.ts missing buildJzkWeekReportSpoken()')
  }
  // JSU and JZK must not be mixed — JSU report must reference Thu, JZK must reference Tue
  if (c.includes('Thu 18') || c.includes('Thursday 18') || c.includes('Thursday 18:00')) {
    pass('responses.ts JSU report references Thursday 18:00')
  } else {
    fail('responses.ts JSU report does not reference the Thursday 18:00 schedule')
  }
  if (c.includes('Tue 18') || c.includes('Tuesday 18') || c.includes('Tuesday 18:00')) {
    pass('responses.ts JZK report references Tuesday 18:00')
  } else {
    fail('responses.ts JZK report does not reference the Tuesday 18:00 schedule')
  }
}

// 9. intent.ts has jzk_week_report handler
if (!exists('src/brain/intent.ts')) {
  fail('src/brain/intent.ts does not exist')
} else {
  const c = read('src/brain/intent.ts')
  if (c.includes('jzk_week_report') || c.includes('buildJzkWeekReport')) {
    pass('intent.ts has jzk_week_report intent handler')
  } else {
    fail('intent.ts missing jzk_week_report intent handler')
  }
  if (c.includes('jezykozak') || c.includes('jak poszedl jzk')) {
    pass('intent.ts recognizes "jezykozak" / "jak poszedl jzk" queries')
  } else {
    fail('intent.ts missing JZK trigger phrases')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Webinar schedule classification rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} webinar schedule violation(s).`)
  process.exit(1)
}
