// English UI strings — single source of truth for the EN locale.

const en = {
  // ── KPI card labels ────────────────────────────────────────────────────────
  kpi: {
    wixOrders:        'Wix Orders',
    wixRevenue:       'Wix Revenue',
    adSpend:          'Ad Spend',
    estProfit:        'Est. Profit',
    realCpa:          'Real CPA',
    realRoas:         'Real ROAS',
    marginBeforeAds:  'Margin Before Ads',
    profitPerOrder:   'Profit / Order',
    trueCpa:          'True CPA',
    marginRoas:       'Margin ROAS',
    unmappedRevenue:  'Unmapped Revenue',
    metaAttr:         'Meta Attr.',
  },

  // ── KPI sub-labels ─────────────────────────────────────────────────────────
  sublabel: {
    marginMinusSpend:   'Margin − ad spend',
    metaSpendPerOrder:  'Meta spend / Wix orders',
    revenuePerSpend:    'Wix revenue / Meta spend',
    knownContribution:  'Known contribution margin',
    afterAdSpend:       'After ad spend',
    adSpendPerOrder:    'Ad spend ÷ paid orders',
    revenuePerAdSpend:  'Revenue ÷ ad spend',
    needsMapping:       'Needs margin mapping',
    allProductsMapped:  'All products mapped',
    metaReported:       'Meta-reported purchases',
  },

  // ── Status / loading messages ──────────────────────────────────────────────
  status: {
    loading:            'Loading data…',
    noDataYet:          'No data for today yet — showing latest available',
    filterMismatch:     '⚠ Profit endpoint returned 0 orders but ordersData shows orders today — filter mismatch or stale cache.',
    unmappedWarning:    '⚠ revenue from unmapped products — contribution margin not included in Est. Profit.',
  },

  // ── Panel section headers ──────────────────────────────────────────────────
  panel: {
    revenueTrend:   'Revenue Trend — 7 Days',
    roasFormula:    'Real ROAS = Wix Revenue ÷ Meta Spend',
    cpaFormula:     'Real CPA = Meta Spend ÷ Wix Orders',
    campaigns:      'Campaigns',
    jsuFunnel:      'JSU Webinar Funnel',
    diagnostics:    'Diagnostics',
    settings:       'Settings',
  },

  // ── Voice / command UI ─────────────────────────────────────────────────────
  voice: {
    listening:      'Listening…',
    thinking:       'Thinking…',
    tapToSpeak:     'Tap to speak',
    holdToSpeak:    'Hold to speak',
    notSupported:   'Speech recognition not supported in this browser.',
  },

  // ── Data freshness ─────────────────────────────────────────────────────────
  freshness: {
    fresh:    'fresh',
    stale:    'stale',
    unknown:  'unknown',
    today:    'today',
  },
}

export type Strings = typeof en
export default en
