#!/usr/bin/env node
// Assert navigation architecture:
// - No "Soon" / disabled dead menu items in sidebar NAV_ITEMS
// - Sidebar has only working nav sections
// - Mobile nav CSS exists in global.css
// - Mobile nav component exists in App.tsx
// - Diagnostics section exists

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const rootDir = process.platform === 'win32' ? root.replace(/^\//, '') : root

let errors = 0
function fail(msg) { console.error('  FAIL', msg); errors++ }
function pass(msg) { console.log('  pass', msg) }

// 1. App.tsx sidebar has no "Soon" disabled items
const appPath = join(rootDir, 'src/App.tsx')
if (!existsSync(appPath)) {
  fail('src/App.tsx does not exist')
} else {
  const c = readFileSync(appPath, 'utf8')

  // Should NOT have the old Intelligence section with "Soon" labels
  if (c.includes('"overview"') && c.includes('"customers"') && c.includes('Soon')) {
    fail('App.tsx still has old Intelligence "Soon" nav items (overview, customers, analytics, reports, settings)')
  } else {
    pass('App.tsx has no dead "Soon" nav items')
  }

  // Should have Diagnostics
  if (c.includes("'diagnostics'") || c.includes('"diagnostics"')) {
    pass('App.tsx has diagnostics nav section')
  } else {
    fail('App.tsx missing diagnostics nav section')
  }

  // MobileNav component
  if (c.includes('MobileNav') && c.includes('mobile-nav')) {
    pass('App.tsx has MobileNav component with mobile-nav className')
  } else {
    fail('App.tsx missing MobileNav component or mobile-nav class')
  }

  // DiagnosticsPanel used
  if (c.includes('DiagnosticsPanel')) {
    pass('App.tsx renders DiagnosticsPanel in diagnostics section')
  } else {
    fail('App.tsx missing DiagnosticsPanel render')
  }
}

// 2. CSS has mobile-nav styles
const cssPath = join(rootDir, 'src/styles/global.css')
if (!existsSync(cssPath)) {
  fail('src/styles/global.css does not exist')
} else {
  const c = readFileSync(cssPath, 'utf8')
  if (c.includes('.mobile-nav') && c.includes('.mobile-nav-item')) {
    pass('global.css has .mobile-nav and .mobile-nav-item styles')
  } else {
    fail('global.css missing .mobile-nav or .mobile-nav-item styles')
  }
  if (c.includes('.scope-chip')) {
    pass('global.css has .scope-chip styles for campaign filter')
  } else {
    fail('global.css missing .scope-chip styles')
  }
  // Mobile nav only shows on mobile (display:none on desktop)
  if (c.includes('.mobile-nav') && c.includes('display: none')) {
    pass('global.css mobile-nav is hidden on desktop (display:none)')
  } else {
    fail('global.css mobile-nav may be visible on desktop — should have display:none as default')
  }

  // Cascade-order guard: the base `.hud-sidebar { display: flex }` rule MUST come
  // BEFORE the `@media (max-width: 699px) { .hud-sidebar { display: none } }`
  // override. Equal specificity + media queries adding no specificity means the
  // later source rule wins — if the base flex rule trails the media query, the
  // desktop sidebar re-appears on mobile and both menus render at once.
  const sidebarFlexIdx = c.indexOf('.hud-sidebar {')
  const mobileBlockIdx = c.indexOf('@media (max-width: 699px)')
  const sidebarHideIdx = c.indexOf('.hud-sidebar { display: none; }', mobileBlockIdx)
  if (sidebarFlexIdx === -1 || sidebarHideIdx === -1) {
    fail('global.css missing base .hud-sidebar rule or mobile .hud-sidebar hide rule')
  } else if (sidebarFlexIdx < sidebarHideIdx) {
    pass('global.css base .hud-sidebar precedes the mobile display:none override (sidebar stays hidden on mobile)')
  } else {
    fail('global.css base ".hud-sidebar { display: flex }" comes AFTER the mobile display:none — desktop sidebar will leak onto mobile (two menus)')
  }
}

// 3. DiagnosticsPanel exists
const diagPath = join(rootDir, 'src/components/DiagnosticsPanel.tsx')
if (!existsSync(diagPath)) {
  fail('src/components/DiagnosticsPanel.tsx does not exist')
} else {
  const c = readFileSync(diagPath, 'utf8')
  if (c.includes('__BUILD_HASH__') && c.includes('latestMetaDate') && c.includes('webinarSessions')) {
    pass('DiagnosticsPanel.tsx shows build stamp, data freshness, and webinar counts')
  } else {
    fail('DiagnosticsPanel.tsx missing build stamp, data freshness, or webinar counts')
  }
}

// 4. NavSection type does not include old dead sections
if (existsSync(appPath)) {
  const c = readFileSync(appPath, 'utf8')
  const hasSoon = /\|\s*['"]overview['"]\s*\|/.test(c) ||
                  /\|\s*['"]customers['"]\s*\|/.test(c) ||
                  /\|\s*['"]analytics['"]\s*\|/.test(c)
  if (hasSoon) {
    fail('NavSection type still includes dead "soon" sections (overview, customers, analytics)')
  } else {
    pass('NavSection type only has live sections')
  }
}

console.log()
if (errors === 0) {
  console.log('PASS — Navigation architecture rules satisfied.')
  process.exit(0)
} else {
  console.error(`FAIL — ${errors} navigation architecture violation(s).`)
  process.exit(1)
}
