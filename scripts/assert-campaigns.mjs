#!/usr/bin/env node
// Assert campaign page architecture:
// - campaignDiagnosis helper exists and uses meta_ads_daily raw table
// - latest-date fallback exists (not just "today only")
// - "No campaign data for today" not used as default when latest rows exist
// - scope chips Memory/JZK/All are present in CampaignsPanel
// - CampaignsPanel uses fetchCampaignRows (not hardcoded date)

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. campaignDiagnosis.ts exists and queries meta_ads_daily
const diagPath = join(rootDir, 'src/lib/campaignDiagnosis.ts')
if (!existsSync(diagPath)) {
  fail('src/lib/campaignDiagnosis.ts does not exist')
} else {
  const c = readFileSync(diagPath, 'utf8')
  if (c.includes("from('meta_ads_daily')")) {
    pass('campaignDiagnosis.ts queries meta_ads_daily raw table')
  } else {
    fail('campaignDiagnosis.ts does not query meta_ads_daily')
  }
  // Latest-date fallback
  if (c.includes('latestRow') || c.includes('latest') || c.includes('fallback')) {
    pass('campaignDiagnosis.ts has latest-date fallback logic')
  } else {
    fail('campaignDiagnosis.ts missing latest-date fallback — will show no data if today has no rows')
  }
  // buildCampaignDiagnosis exists as pure function
  if (c.includes('buildCampaignDiagnosis') && c.includes('fetchCampaignRows')) {
    pass('campaignDiagnosis.ts exports buildCampaignDiagnosis + fetchCampaignRows')
  } else {
    fail('campaignDiagnosis.ts missing buildCampaignDiagnosis or fetchCampaignRows export')
  }
  // Scope classifier exists
  if (c.includes('classifyCampaignScope') && c.includes("'JSU'") && c.includes("'JZK'")) {
    pass('campaignDiagnosis.ts has JSU/JZK scope classifier')
  } else {
    fail('campaignDiagnosis.ts missing classifyCampaignScope or JSU/JZK scopes')
  }
}

// 2. CampaignsPanel.tsx exists and uses campaignDiagnosis
const panelPath = join(rootDir, 'src/components/CampaignsPanel.tsx')
if (!existsSync(panelPath)) {
  fail('src/components/CampaignsPanel.tsx does not exist')
} else {
  const c = readFileSync(panelPath, 'utf8')
  if (c.includes('fetchCampaignRows') && c.includes('buildCampaignDiagnosis')) {
    pass('CampaignsPanel.tsx uses fetchCampaignRows + buildCampaignDiagnosis')
  } else {
    fail('CampaignsPanel.tsx does not use campaign diagnosis helpers')
  }
  // Scope chips present
  if (c.includes("'JSU'") && c.includes("'JZK'") && c.includes("'ALL'")) {
    pass('CampaignsPanel.tsx has JSU/JZK/ALL scope chips')
  } else {
    fail('CampaignsPanel.tsx missing scope chip options')
  }
  // Stale data notice (not "no data for today")
  if (c.includes('latest available') || c.includes('Stale') || c.includes('isStale')) {
    pass('CampaignsPanel.tsx shows stale data notice with date (not "No campaign data for today")')
  } else {
    fail('CampaignsPanel.tsx missing stale data notice')
  }
  // Must NOT use "No campaign data for today" as the only empty message
  if (c.includes('No campaign data for today.') && !c.includes('isStale')) {
    fail('CampaignsPanel.tsx still uses the broken "No campaign data for today." message without date fallback')
  } else {
    pass('CampaignsPanel.tsx does not use "No campaign data for today." as default when latest rows exist')
  }
}

// 3. App.tsx uses CampaignsPanel (not the old TopAds inline)
const appPath = join(rootDir, 'src/App.tsx')
if (!existsSync(appPath)) {
  fail('src/App.tsx does not exist')
} else {
  const c = readFileSync(appPath, 'utf8')
  if (c.includes('CampaignsPanel')) {
    pass('App.tsx uses CampaignsPanel in campaigns section')
  } else {
    fail('App.tsx does not use CampaignsPanel — campaigns page still uses old inline TopAds')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Campaign data architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} campaign architecture violation(s).`)
  process.exit(1)
}
