// GIENIU Command Gateway — EN-only intent routing + LLM fallback.
//
// POST /.netlify/functions/gieniu-command
// Body: { message, context }
// Returns: { answerText, speechText, intent, confidence, dataSourcesUsed, warnings, llmUsed, llmProvider }

// ── Intent detection (mirrors src/brain/intentRouter.ts) ─────────────────────

function normalizeQuery(s) {
  return s
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const INTENT_DEFS = [
  {
    intent: 'profit_today',
    phrases: [
      'profit today', 'how much profit', 'net profit today', 'earned today',
      'profit after ads', 'margin today', 'how much did we earn',
      'estimated profit',
    ],
  },
  {
    intent: 'revenue_today',
    phrases: [
      'revenue today', 'how are we doing today', 'how are we doing',
      'what are sales', 'sales today', 'how much did we make',
      'today revenue', 'how much today', 'total revenue',
    ],
  },
  {
    intent: 'orders_freshness',
    phrases: [
      'are orders updating', 'orders updating', 'orders fresh', 'orders stale',
      'wix updating', 'are orders fresh',
      'orders sync', 'are wix orders updating',
    ],
  },
  {
    intent: 'meta_freshness',
    phrases: [
      'is meta updating', 'meta fresh', 'meta stale', 'meta data updating',
      'facebook updating', 'ads updating',
    ],
  },
  {
    intent: 'campaigns_today',
    phrases: [
      'why are campaigns not showing', 'campaigns not showing', 'campaign performance',
      'which campaigns', 'best campaign', 'top campaign', 'show me campaigns',
      'campaign data', 'what campaigns',
      'which creative', 'which ad', 'creative breakdown', 'per ad', 'per creative',
      'ad performance', 'which ad is burning', 'which creative is best',
      'which creative is worst', 'ad breakdown', 'creative data',
    ],
  },
  {
    intent: 'jsu_funnel',
    phrases: [
      'why did jsu not sell', 'why jsu not selling',
      'jsu funnel', 'webinar jsu', 'jsu webinar', 'funnel jsu',
      'who attended and bought',
      'attendance rate', 'webinar funnel', 'jsu',
    ],
  },
  {
    intent: 'data_health',
    phrases: [
      'data health', 'data status',
      'are data fresh', 'is data fresh', 'data freshness',
      'system status',
    ],
  },
  {
    intent: 'red_flags',
    phrases: [
      'what needs attention', 'what should i fix first',
      'what is wrong', 'issues today',
      'red flags', 'what to fix', 'what is broken', 'biggest problem',
    ],
  },
  {
    intent: 'retargeting',
    phrases: [
      'what to kill',
      'what should i kill', 'stop campaigns', 'kill campaigns',
      'wasting money', 'what is wasting money', 'what to scale',
      'what should i scale', 'retargeting', 'retarget',
    ],
  },
  {
    intent: 'creative_recommendations',
    phrases: [
      'creative recommendations', 'best ad creative', 'top performing ad',
      'which ad is best', 'creative performance',
      'which creative is performing', 'best creative today', 'worst creative today',
      'which ad to pause', 'which ad to scale', 'creative ranking',
    ],
  },
  {
    intent: 'email_rhythm',
    phrases: [
      'email performance', 'email rhythm',
      'mailing performance', 'deliverability',
    ],
  },
  {
    intent: 'today_vs_yesterday',
    phrases: [
      'vs yesterday', 'today vs', 'compare today', 'today against yesterday',
      'compare days', 'today vs yesterday',
    ],
  },
  {
    intent: 'yesterday',
    phrases: [
      'how was yesterday', 'yesterday', 'what happened yesterday',
    ],
  },
  {
    intent: 'week_summary',
    phrases: [
      'week so far', 'this week', 'week to date', 'wtd',
      'weekly trend',
    ],
  },
  {
    intent: 'last_7_days',
    phrases: [
      'last 7', 'last seven', 'past 7', 'past seven',
      '7 days', 'seven days', 'last 7 days',
    ],
  },
  {
    intent: 'morning_brief',
    phrases: [
      'morning brief', 'morning briefing', 'daily brief', 'daily briefing',
      'wake gieniu', 'start briefing', 'give me a brief',
      'brief me', 'what happened today', 'summary', 'give me the summary',
    ],
  },
  {
    intent: 'sales_by_product',
    phrases: [
      'sales by product', 'what did we sell', 'what did we sell today', 'products sold today',
      'how many courses today', 'how many jsu', 'how many memory packs', 'jsu today',
      'product breakdown', 'sales breakdown',
    ],
  },
  {
    intent: 'meta_efficiency',
    phrases: [
      'ctr', 'cpc', 'cpm', 'click through rate', 'cost per click', 'cost per mille',
      "what's the ctr", 'what is the ctr', 'whats the ctr',
      "what's the cpc", 'what is the cpc', 'whats the cpc',
      'click rate',
      'ad efficiency', 'campaign efficiency', 'meta efficiency',
    ],
  },
]

function detectIntent(message) {
  const norm = normalizeQuery(message)
  let bestScore = 0
  let bestIntent = 'normal_chat'
  let bestMatches = []

  for (const def of INTENT_DEFS) {
    const matches = []
    for (const phrase of def.phrases) {
      if (norm.includes(normalizeQuery(phrase))) matches.push(phrase)
    }
    if (matches.length > 0) {
      const maxWords = Math.max(...matches.map(m => m.split(/\s+/).length))
      const score = 0.4 + Math.min((maxWords - 1) * 0.15, 0.55)
      if (score > bestScore) {
        bestScore = score
        bestIntent = def.intent
        bestMatches = matches
      }
    }
  }

  return {
    intent: bestScore >= 0.4 ? bestIntent : 'normal_chat',
    confidence: Math.min(bestScore, 1.0),
    language: 'en',
    matchedTerms: bestMatches,
  }
}

// ── Deterministic answer builders ─────────────────────────────────────────────

function fmt(n, digits = 2) {
  return n != null ? n.toFixed(digits) : '—'
}

function buildRevenueAnswer(ctx) {
  const kpi = ctx.todayKPIs
  if (!kpi) {
    const msg = 'No KPI data for today. Check Wix sync in the Automation tab.'
    return { text: msg, speech: msg, sources: [], warnings: ['todayKPIs unavailable'] }
  }
  const orders = kpi.wix_orders ?? 0
  const revenue = kpi.wix_revenue ?? 0
  const spend = kpi.meta_spend ?? 0
  const roas = kpi.real_roas != null ? `${fmt(kpi.real_roas)}x` : '—'
  const cpa = kpi.real_cpa != null ? `${fmt(kpi.real_cpa)} PLN` : '—'

  if (orders === 0 && revenue === 0) {
    const msg = `No orders recorded today yet. Meta spend: ${fmt(spend)} PLN. Check Wix sync.`
    return { text: msg, speech: msg, sources: ['todayKPIs'], warnings: ['no orders today'] }
  }

  return {
    text: `${orders} orders | ${fmt(revenue)} PLN revenue\nMeta spend: ${fmt(spend)} PLN\nReal ROAS: ${roas} | Real CPA: ${cpa}`,
    speech: `${orders} orders, ${fmt(revenue)} PLN revenue today. Meta spend: ${fmt(spend)} PLN.`,
    sources: ['todayKPIs'],
    warnings: [],
  }
}

function buildProfitAnswer(ctx) {
  const p = ctx.profitData
  if (!p?.ok) {
    const msg = 'Profit data is not available right now. Check the profit endpoint in Diagnostics.'
    return { text: msg, speech: msg, sources: [], warnings: ['profitData unavailable'] }
  }
  const profit = p.estimatedProfitAfterAds ?? 0
  const verdict = profit > 100 ? 'Profitable day.' : profit >= 0 ? 'Break-even territory.' : 'Spending more than earning.'
  const unknown = (p.unknownRevenue ?? 0) > 0
    ? `\n⚠ ${fmt(p.unknownRevenue)} PLN unmapped revenue excluded from profit.`
    : ''

  return {
    text: `${verdict}\nContribution margin: ${fmt(p.marginBeforeAds)} PLN\nMeta spend: ${fmt(p.adSpend)} PLN\nEst. profit: ${fmt(profit)} PLN\nProfit/order: ${fmt(p.estimatedProfitPerOrder)} PLN${unknown}`,
    speech: `${verdict} Margin: ${fmt(p.marginBeforeAds)} PLN. Spend: ${fmt(p.adSpend)} PLN. Estimated profit: ${fmt(profit)} PLN.`,
    sources: ['profitData'],
    warnings: unknown ? ['unmapped revenue excluded'] : [],
  }
}

function buildOrdersFreshnessAnswer(ctx) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const fresh = dh.wixFresh
  const date = dh.latestWixDate ?? '—'
  const today = dh.today ?? '—'
  if (fresh) {
    const msg = `Orders are up to date. Latest Wix date: ${date} (today).`
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const text = `Orders may be stale. Latest Wix date: ${date}. Expected: ${today}.\nNext action: Check Make → Wix sync in the Automation tab.`
  return {
    text,
    speech: `Orders may be stale. Latest date: ${date}.`,
    sources: ['dataHealth'],
    warnings: [`Wix date ${date} may be stale (expected ${today})`],
  }
}

function buildMetaFreshnessAnswer(ctx) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const fresh = dh.metaFresh
  const date = dh.latestMetaDate ?? '—'
  if (fresh) {
    const msg = `Meta is updating. Latest date: ${date} (today).`
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const text = `Meta data may be stale. Latest date: ${date}. Meta usually lags 1-3 hours. If longer — check Meta Ads integration.`
  return {
    text,
    speech: `Meta data stale. Latest date: ${date}.`,
    sources: ['dataHealth'],
    warnings: [`Meta date ${date} may be stale`],
  }
}

function buildDataHealthAnswer(ctx) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const issues = []
  if (!dh.metaFresh) issues.push(`Meta data stale (${dh.latestMetaDate})`)
  if (!dh.wixFresh) issues.push(`Wix orders stale (${dh.latestWixDate})`)
  if (issues.length === 0) {
    const msg = 'All data sources fresh. Meta and Wix are up to date.'
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const issueList = issues.map(i => `⚠ ${i}`).join('\n')
  return {
    text: 'Data health issues:\n' + issueList + '\nCheck the Automation tab.',
    speech: `${issues.length} data issue${issues.length > 1 ? 's' : ''}: ${issues.join('. ')}.`,
    sources: ['dataHealth'],
    warnings: issues,
  }
}

function buildCampaignsAnswer(ctx) {
  const campaigns = ctx.topCampaigns ?? []
  if (campaigns.length === 0) {
    const msg = 'No ad/creative data loaded. Check Meta Ads sync in the Automation tab.'
    return { text: msg, speech: msg, sources: [], warnings: ['no campaign data'] }
  }
  const sorted = [...campaigns].sort((a, b) => b.spend - a.spend)
  const totalSpend = sorted.reduce((s, c) => s + c.spend, 0)

  const rows = sorted.slice(0, 10).map(c => {
    const displayName = c.ad_name ?? c.name
    const imp   = c.impressions ?? 0
    const cl    = c.clicks ?? 0
    const lcl   = c.link_clicks ?? cl
    const ctr   = imp > 0 ? (lcl / imp * 100).toFixed(2) + '%' : '—'
    const cpc   = cl  > 0 ? fmt(c.spend / cl) + ' PLN' : '—'
    const metaCpa = c.purchases > 0 ? fmt(c.spend / c.purchases) + ' PLN' : 'no purch.'
    const shareStr = totalSpend > 0 ? ` (${(c.spend / totalSpend * 100).toFixed(0)}%)` : ''
    return `  ${displayName}: spend ${fmt(c.spend)} PLN${shareStr} | purch. ${c.purchases} | CPA ${metaCpa} | CTR ${ctr} | CPC ${cpc} | clicks ${cl}`
  })

  const withPurchases = sorted.filter(c => c.purchases > 0)
  const best  = withPurchases.length > 0 ? withPurchases.reduce((a, b) => (a.spend / a.purchases) < (b.spend / b.purchases) ? a : b) : null
  const worst = withPurchases.length > 1 ? withPurchases.reduce((a, b) => (a.spend / a.purchases) > (b.spend / b.purchases) ? a : b) : null
  const zeroPurchase = sorted.filter(c => c.purchases === 0 && c.spend > 5)

  const lines = [`— ADS / CREATIVES TODAY (${sorted.length} ads) —`, '']
  lines.push(...rows)
  if (best)  lines.push('', `Best: "${best.ad_name ?? best.name}" — ${best.purchases} purchases, CPA ${fmt(best.spend / best.purchases)} PLN`)
  if (worst && worst !== best) lines.push(`Weakest: "${worst.ad_name ?? worst.name}" — CPA ${fmt(worst.spend / worst.purchases)} PLN`)
  if (zeroPurchase.length > 0) lines.push(`Zero purchases (spending): ${zeroPurchase.map(c => `"${c.ad_name ?? c.name}" ${fmt(c.spend)} PLN`).join(', ')}`)

  const topName = sorted[0] ? (sorted[0].ad_name ?? sorted[0].name) : '—'
  const speech = best
    ? `${sorted.length} ads today. Best creative: "${best.ad_name ?? best.name}", ${best.purchases} purchases at ${fmt(best.spend / best.purchases, 0)} PLN CPA.`
    : `${sorted.length} ads today. Top spender: "${topName}". No Meta purchases recorded yet.`

  return {
    text: lines.join('\n'),
    speech,
    sources: ['topCampaigns'],
    warnings: [],
  }
}

function buildMorningBriefAnswer(ctx) {
  const kpi    = ctx.todayKPIs
  const trend  = ctx.recentTrend ?? []
  const tbp    = ctx.todayByProduct
  const today  = ctx.dataHealth?.today ?? ''
  const yDate  = today ? prevDay(today) : null
  const yRow   = (yDate ? trend.find(r => r.date === yDate) : null) ?? trend[1] ?? null

  if (!kpi && trend.length === 0) {
    const msg = "I'm afraid the data is not yet available, sir. Kindly initialise again in a moment."
    return { text: msg, speech: msg, sources: [], warnings: ['no data'] }
  }

  const orders  = kpi?.wix_orders  ?? 0
  const revenue = kpi?.wix_revenue  ?? 0
  const spend   = kpi?.meta_spend   ?? 0
  const cpa     = kpi?.real_cpa
  const roas    = kpi?.real_roas
  const yOrders = yRow?.wix_orders  ?? null
  const yRev    = yRow?.wix_revenue ?? null
  const revDelta   = yRev    != null ? revenue - yRev    : null
  const orderDelta = yOrders != null ? orders  - yOrders : null
  const jsuCount = tbp?.jsu_course?.count   ?? 0
  const memCount = tbp?.memory_pack?.count  ?? 0
  const jzkCount = tbp?.jzk_language?.count ?? 0

  // Week trend: last 7 rows from trend (skip today = index 0)
  const weekRows = trend.filter(r => r.date !== today).slice(0, 7)
  const weekTotalRev    = weekRows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const weekTotalOrders = weekRows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const weekSpend       = weekRows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const cpaRows         = weekRows.filter(r => r.real_cpa != null)
  const weekAvgCpa      = cpaRows.length > 0 ? cpaRows.reduce((s, r) => s + (r.real_cpa ?? 0), 0) / cpaRows.length : null
  const hasWeekData     = weekRows.length >= 2

  // Red flags
  const redFlags = []
  if (cpa != null && cpa > 50) redFlags.push(`Real CPA ${fmt(cpa)} PLN — exceeds the 50 PLN alert threshold`)
  if (spend > 0 && orders === 0) redFlags.push('Meta spend active, zero Wix orders')
  if (roas != null && roas < 2 && spend > 50) redFlags.push(`ROAS ${fmt(roas)}x — below breakeven`)
  if (memCount > 0 && jsuCount === 0 && memCount >= 3) redFlags.push(`${memCount} PP buyers with zero JSU conversions. Check upsell sequence.`)

  // Recommendation
  let rec
  if (cpa != null && cpa > 50) {
    rec = 'I would venture to suggest, sir: review high-CPA campaigns and consider pausing the weakest creatives.'
  } else if (spend > 0 && orders === 0) {
    rec = 'I would venture to suggest, sir: inspect the landing page — budget is flowing, but conversions are absent.'
  } else if (memCount > 0 && jsuCount === 0) {
    rec = `I would venture to suggest, sir: ${memCount} PP buyer${memCount > 1 ? 's' : ''} without JSU — confirm the Thursday webinar upsell sequence is live.`
  } else if (jsuCount > 0) {
    rec = `I would venture to suggest, sir: ${jsuCount} JSU course${jsuCount > 1 ? 's' : ''} — confirm the WSZTP high-ticket sequence has been dispatched.`
  } else if (revDelta != null && revDelta < -100) {
    rec = 'I would venture to suggest, sir: today trails yesterday — check whether campaigns are in the learning phase or require adjustment.'
  } else {
    rec = 'I would venture to suggest, sir: monitor CPA and revenue hourly — the day is still in progress, sir.'
  }

  // Persona opening (one sharp line, context-dependent)
  let opening
  if (orders > 4 && (cpa == null || cpa < 40)) {
    opening = 'The numbers are rather agreeable this morning, sir. Allow me to present them.'
  } else if (spend > 0 && orders === 0) {
    opening = 'The budget is active, sir, yet the orders have not arrived. A matter requiring immediate attention.'
  } else if (cpa != null && cpa > 60) {
    opening = 'The situation calls for calm precision, sir. Here is the brief.'
  } else {
    opening = 'At your service, sir. The morning operational brief from STANLEY HQ.'
  }

  const lines = ['— MORNING BRIEF —', '', opening, '']
  lines.push(`Today (${today || '?'}):`)
  lines.push(`  Orders: ${orders}  |  Revenue: ${fmt(revenue)} PLN  |  Meta spend: ${fmt(spend)} PLN`)
  if (cpa != null) lines.push(`  Real CPA: ${fmt(cpa)} PLN  |  ROAS: ${roas != null ? fmt(roas) + 'x' : '—'}`)
  if (revDelta != null || orderDelta != null) {
    lines.push('')
    lines.push(`vs Yesterday (${yRow?.date ?? '?'}):`)
    if (orderDelta != null) lines.push(`  Orders:  ${sign(orderDelta)}${orderDelta}`)
    if (revDelta   != null) lines.push(`  Revenue: ${sign(revDelta)}${fmt(revDelta)} PLN`)
  }
  if (hasWeekData) {
    const weekLine = `Last ${weekRows.length} days: ${fmt(weekTotalRev)} PLN revenue, ${weekTotalOrders} orders${weekAvgCpa != null ? `, avg CPA ${fmt(weekAvgCpa)} PLN` : ''}.`
    lines.push('', weekLine)
  }
  if (tbp) {
    lines.push('')
    lines.push('Sales by product (today):')
    if (memCount > 0) lines.push(`  Pakiet Pamięciowy: ${memCount}`)
    if (jsuCount > 0) lines.push(`  Kurs Jak się uczyć: ${jsuCount}`)
    if (jzkCount > 0) lines.push(`  Językozak/Language Pack: ${jzkCount}`)
    if (memCount + jsuCount + jzkCount === 0) lines.push('  No sales yet.')
  }
  if (redFlags.length > 0) {
    lines.push('')
    lines.push('🚨 Alert:')
    redFlags.forEach(f => lines.push(`  ⚠ ${f}`))
  }
  lines.push('', rec)
  const sp = [opening, `Today: ${orders} order${orders !== 1 ? 's' : ''}, ${fmt(revenue, 0)} PLN revenue`]
  if (revDelta != null) sp.push(`${revDelta >= 0 ? 'up' : 'down'} ${fmt(Math.abs(revDelta), 0)} vs yesterday`)
  if (redFlags.length > 0) sp.push(redFlags[0])
  const speech = sp.join('. ') + '. ' + rec
  return { text: lines.join('\n'), speech, sources: ['todayKPIs', 'recentTrend', 'todayByProduct'], warnings: [] }
}

function buildSalesByProductAnswer(ctx) {
  const tbp = ctx.todayByProduct
  if (!tbp) {
    const msg = "I'm afraid today's product breakdown is unavailable, sir. Orders data was not loaded."
    return { text: msg, speech: msg, sources: [], warnings: ['no todayByProduct'] }
  }

  const jsu    = tbp.jsu_course   ?? { count: 0, revenue: 0 }
  const jzk    = tbp.jzk_language ?? { count: 0, revenue: 0 }
  const mem    = tbp.memory_pack   ?? { count: 0, revenue: 0 }
  const unk    = tbp.unknown       ?? { count: 0 }
  const total  = jsu.count + jzk.count + mem.count + unk.count

  if (total === 0) {
    const msg = 'No sales recorded today, sir. The ledger remains pristine — the day is not yet done.'
    return { text: msg, speech: msg, sources: ['todayByProduct'], warnings: [] }
  }

  const lines = []
  const hasSales = (p) => p.count > 0

  lines.push('— TODAY\'S SALES BY PRODUCT —', '')
  if (hasSales(mem)) lines.push(`Pakiet Pamięciowy:    ${mem.count} × 119 PLN = ${fmt(mem.revenue)} PLN`)
  if (hasSales(jsu)) lines.push(`Kurs Jak się uczyć:   ${jsu.count} × 549 PLN = ${fmt(jsu.revenue)} PLN`)
  if (hasSales(jzk)) lines.push(`Językozak / Language: ${jzk.count} units = ${fmt(jzk.revenue)} PLN`)
  if (hasSales(unk)) lines.push(`Unmapped:             ${unk.count} units`)
  lines.push('')
  lines.push(`Total: ${total} sales`)

  // Verdict / recommendation
  const hasJsu = jsu.count > 0
  const hasMem = mem.count > 0
  let verdict = ''
  if (hasJsu && hasMem) {
    verdict = `I would venture to suggest, sir: ${jsu.count} JSU course${jsu.count > 1 ? 's' : ''} is an encouraging sign — consider dispatching the upsell sequence to the ${mem.count} PP buyer${mem.count > 1 ? 's' : ''} who have not yet converted.`
  } else if (hasMem && !hasJsu) {
    verdict = `I would venture to suggest, sir: ${mem.count} Memory Pack${mem.count > 1 ? 's' : ''}, zero JSU courses. The upsell sequence toward Thursday's webinar should be live and running.`
  } else if (hasJsu && !hasMem) {
    verdict = `I would venture to suggest, sir: JSU sales without PP — verify the cold traffic campaign is active and feeding fresh buyers into the funnel.`
  }
  if (verdict) lines.push('', verdict)

  const speechParts = []
  if (hasSales(mem)) speechParts.push(`${mem.count} Memory Pack${mem.count > 1 ? 's' : ''}`)
  if (hasSales(jsu)) speechParts.push(`${jsu.count} JSU course${jsu.count > 1 ? 's' : ''}`)
  if (hasSales(jzk)) speechParts.push(`${jzk.count} Językozak`)
  const speech = `Today's sales, sir: ${speechParts.join(', ')}. ${total} total.`

  return { text: lines.join('\n'), speech, sources: ['todayByProduct'], warnings: [] }
}

function buildEfficiencyAnswer(ctx) {
  // Prefer ctx.metaEfficiency (pre-computed from all ads), fall back to summing topCampaigns
  let clicks, linkClicks, impressions, spend, ctr, cpc, cpm
  const eff = ctx.metaEfficiency
  if (eff && (eff.clicks > 0 || eff.impressions > 0)) {
    clicks      = eff.clicks ?? 0
    linkClicks  = eff.link_clicks ?? clicks
    impressions = eff.impressions ?? 0
    spend       = eff.spend ?? 0
    ctr         = eff.ctr   ?? (impressions > 0 ? linkClicks / impressions * 100 : null)
    cpc         = eff.cpc   ?? (clicks > 0 ? spend / clicks : null)
    cpm         = eff.cpm   ?? (impressions > 0 ? spend / impressions * 1000 : null)
  } else {
    const campaigns = ctx.topCampaigns ?? []
    if (campaigns.length === 0) {
      const msg = 'No campaign data — CTR/CPC/CPM unavailable. Check Meta Ads sync.'
      return { text: msg, speech: msg, sources: [], warnings: ['no efficiency data'] }
    }
    clicks      = campaigns.reduce((s, c) => s + (c.clicks ?? 0), 0)
    linkClicks  = campaigns.reduce((s, c) => s + (c.link_clicks ?? c.clicks ?? 0), 0)
    impressions = campaigns.reduce((s, c) => s + (c.impressions ?? 0), 0)
    spend       = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0)
    ctr         = impressions > 0 ? linkClicks / impressions * 100 : null
    cpc         = clicks > 0 ? spend / clicks : null
    cpm         = impressions > 0 ? spend / impressions * 1000 : null
  }

  if (impressions === 0 && clicks === 0) {
    const msg = 'No impressions or clicks data — CTR/CPC/CPM unavailable. Check Meta Ads sync in Automation.'
    return { text: msg, speech: msg, sources: [], warnings: ['no impressions/clicks'] }
  }

  const ctrStr = ctr  != null ? ctr.toFixed(2)  + '%'     : '—'
  const cpcStr = cpc  != null ? fmt(cpc) + ' PLN'          : '—'
  const cpmStr = cpm  != null ? fmt(cpm) + ' PLN'          : '—'

  const verdict = ctr != null
    ? (ctr >= 2
        ? `CTR at ${ctrStr} — solid (benchmark 1-2%).`
        : ctr >= 1
          ? `CTR at ${ctrStr} — average. Test new creatives.`
          : `CTR at ${ctrStr} — below benchmark. Creatives need review.`)
    : ''

  // Per-campaign breakdown
  const campaigns = ctx.topCampaigns ?? []
  const perCampaign = [...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5).map(c => {
    const imp  = c.impressions ?? 0
    const cl   = c.clicks ?? 0
    const lcl  = c.link_clicks ?? cl
    const cCtr = imp > 0 ? (lcl / imp * 100).toFixed(2) + '%' : '—'
    const cCpc = cl  > 0 ? fmt(c.spend / cl) + ' PLN' : '—'
    return `  ${c.name}: CTR ${cCtr} | CPC ${cCpc} | ${cl} clicks / ${imp} impr.`
  })

  const lines = [
    '— META ADS EFFICIENCY (TODAY) —', '',
    `CTR (link clicks / impressions): ${ctrStr}`,
    `CPC (cost per click):            ${cpcStr}`,
    `CPM (cost per 1000 impressions): ${cpmStr}`,
    '',
    `Totals: ${clicks} clicks | ${impressions} impressions | ${fmt(spend)} PLN spend`,
  ]
  if (perCampaign.length > 0) {
    lines.push('', 'Per campaign:')
    lines.push(...perCampaign)
  }
  if (verdict) lines.push('', verdict)
  const speech = `CTR: ${ctrStr}. CPC: ${cpcStr}. CPM: ${cpmStr}. ${verdict}`
  return { text: lines.join('\n'), speech, sources: ['metaEfficiency', 'topCampaigns'], warnings: [] }
}

function buildJsuFunnelAnswer(ctx) {
  const jsu = ctx.jsuSummary
  if (!jsu || jsu.bottleneck === 'NO_DATA' || jsu.bottleneck === 'NO_SOURCES') {
    const msg = 'JSU webinar funnel data is not available. Check Make → ClickMeeting sync in Automation.'
    return { text: msg, speech: msg, sources: [], warnings: ['jsuSummary unavailable'] }
  }
  const bottleneck = jsu.bottleneck ?? 'OK'
  const diagnosis = jsu.diagnosis ?? ''
  const att = jsu.rates?.attendance_rate != null ? `${(jsu.rates.attendance_rate * 100).toFixed(1)}%` : '—'
  const pur = jsu.rates?.purchase_rate != null ? `${(jsu.rates.purchase_rate * 100).toFixed(1)}%` : '—'
  const totals = jsu.totals ?? {}

  return {
    text: `JSU Funnel — Bottleneck: ${bottleneck}\n${diagnosis}\nAttendance: ${att} | Purchase conversion: ${pur}\nRegistered: ${totals.registered ?? '—'} | Attended: ${totals.attendees ?? '—'} | Bought: ${totals.purchases ?? '—'}`,
    speech: `JSU bottleneck: ${bottleneck}. Attendance: ${att}. Conversion: ${pur}.`,
    sources: ['jsuSummary'],
    warnings: [],
  }
}

function buildRedFlagsAnswer(ctx) {
  const flags = []
  const dh = ctx.dataHealth
  const p = ctx.profitData
  const kpi = ctx.todayKPIs

  if (dh && !dh.metaFresh) flags.push(`Meta data stale (${dh.latestMetaDate})`)
  if (dh && !dh.wixFresh) flags.push(`Wix orders stale (${dh.latestWixDate})`)
  if (p?.ok && (p.estimatedProfitAfterAds ?? 0) < 0) flags.push(`Negative profit: ${fmt(p.estimatedProfitAfterAds)} PLN`)
  if (kpi?.real_cpa != null && kpi.real_cpa > 60) flags.push(`CPA very high: ${fmt(kpi.real_cpa)} PLN`)
  if (kpi?.real_roas != null && kpi.real_roas < 1.5) flags.push(`ROAS low: ${fmt(kpi.real_roas)}x`)
  if ((p?.unknownRevenue ?? 0) > 100) flags.push(`${fmt(p?.unknownRevenue)} PLN unmapped revenue`)

  if (flags.length === 0) {
    const msg = 'No critical issues detected in dashboard data.'
    return { text: msg, speech: msg, sources: ['todayKPIs', 'profitData', 'dataHealth'], warnings: [] }
  }

  const list = flags.map((f, i) => `${i + 1}. ${f}`).join('\n')
  return {
    text: `Red flags (${flags.length}):\n` + list,
    speech: `${flags.length} red flag${flags.length > 1 ? 's' : ''}. Top: ${flags[0]}.`,
    sources: ['todayKPIs', 'profitData', 'dataHealth'],
    warnings: flags,
  }
}

// ── Helpers for historical builders ───────────────────────────────────────────

function prevDay(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function sign(n) { return n >= 0 ? '+' : '' }

// ── Historical data builders ───────────────────────────────────────────────────

function buildYesterdayAnswer(ctx) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = 'No historical data available — recentTrend was not loaded.'
    return { text: msg, speech: msg, sources: [], warnings: ['no recentTrend'] }
  }
  const today   = ctx.dataHealth?.today ?? ''
  const yDate   = today ? prevDay(today) : null
  const row     = (yDate ? trend.find(r => r.date === yDate) : null) ?? trend[1] ?? null

  if (!row) {
    const msg = `No data for yesterday (${yDate ?? '?'}). Available dates: ${trend.map(r => r.date).join(', ')}.`
    return { text: msg, speech: msg, sources: ['recentTrend'], warnings: ['no yesterday row'] }
  }

  const orders    = row.wix_orders   ?? 0
  const revenue   = row.wix_revenue  ?? 0
  const spend     = row.meta_spend   ?? 0
  const cpa       = row.real_cpa
  const roas      = row.real_roas
  const purchases = row.meta_purchases ?? 0

  const verdict = spend > 0 && orders === 0
    ? 'Spend went out, nothing came back.'
    : roas != null && roas >= 3
      ? `Good day — ROAS at ${fmt(roas)}x.`
      : roas != null && roas < 2
        ? 'Weak ROAS — ads underperformed.'
        : orders > 0
          ? 'Solid operational day.'
          : 'No sales data.'

  const lines = [
    `— YESTERDAY ${row.date} —`, '',
    `Orders: ${orders}`,
    `Revenue: ${fmt(revenue)} PLN`,
    `Meta spend: ${fmt(spend)} PLN`,
  ]
  if (cpa  != null) lines.push(`Real CPA: ${fmt(cpa)} PLN`)
  if (roas != null) lines.push(`Real ROAS: ${fmt(roas)}x`)
  if (purchases > 0) lines.push(`Meta purchases: ${purchases}`)
  lines.push('', verdict)
  const speech = `Yesterday, ${row.date}: ${orders} orders, ${fmt(revenue, 0)} PLN revenue, ${fmt(spend, 0)} PLN spend.${roas != null ? ` ROAS ${fmt(roas)}x.` : ''}`
  return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
}

function buildTodayVsYesterdayAnswer(ctx) {
  const trend   = ctx.recentTrend ?? []
  const today   = ctx.dataHealth?.today ?? ''
  const yDate   = today ? prevDay(today) : null

  // Today: prefer todayKPIs (freshest), fall back to trend[0]
  const todayKpi = ctx.todayKPIs
  const todayRow = todayKpi
    ? { date: todayKpi.date ?? today, wix_orders: todayKpi.wix_orders ?? 0, wix_revenue: todayKpi.wix_revenue ?? 0, meta_spend: todayKpi.meta_spend ?? 0, real_cpa: todayKpi.real_cpa ?? null, real_roas: todayKpi.real_roas ?? null }
    : (trend[0] ?? null)
  const yRow = (yDate ? trend.find(r => r.date === yDate) : null) ?? trend[1] ?? null

  if (!todayRow || !yRow) {
    const msg = `Cannot compare — missing data. Available dates: ${trend.map(r => r.date).join(', ') || 'none'}.`
    return { text: msg, speech: msg, sources: [], warnings: ['insufficient trend data'] }
  }

  const todayOrders  = todayRow.wix_orders  ?? 0
  const yOrders      = yRow.wix_orders      ?? 0
  const todayRevenue = todayRow.wix_revenue  ?? 0
  const yRevenue     = yRow.wix_revenue      ?? 0
  const todaySpend   = todayRow.meta_spend   ?? 0
  const ySpend       = yRow.meta_spend       ?? 0
  const revDelta     = todayRevenue - yRevenue
  const orderDelta   = todayOrders  - yOrders
  const spendDelta   = todaySpend   - ySpend
  const revPct       = yRevenue > 0 ? (revDelta / yRevenue * 100) : null

  const verdict = revDelta > 0
    ? 'Today is ahead of yesterday. Good trend, Lifidi.'
    : revDelta < 0
      ? 'Today is behind yesterday. Day not over — check campaigns.'
      : 'Identical to yesterday.'

  const lines = [
    `— TODAY vs YESTERDAY —`, '',
    `                Yesterday (${yRow.date})   Today (${todayRow.date ?? today})`,
    `Orders:         ${yOrders}                   ${todayOrders}   (${sign(orderDelta)}${orderDelta})`,
    `Revenue:        ${fmt(yRevenue)} PLN          ${fmt(todayRevenue)} PLN   (${sign(revDelta)}${fmt(revDelta)}${revPct != null ? `, ${sign(revPct)}${revPct.toFixed(0)}%` : ''})`,
    `Meta spend:     ${fmt(ySpend)} PLN            ${fmt(todaySpend)} PLN   (${sign(spendDelta)}${fmt(spendDelta)})`,
  ]
  if (todayRow.real_roas != null && yRow.real_roas != null) {
    const rd = (todayRow.real_roas ?? 0) - (yRow.real_roas ?? 0)
    lines.push(`ROAS:           ${fmt(yRow.real_roas)}x                 ${fmt(todayRow.real_roas)}x   (${sign(rd)}${fmt(rd)})`)
  }
  lines.push('', verdict)
  const speech = `Today vs yesterday. Revenue: ${fmt(todayRevenue, 0)} vs ${fmt(yRevenue, 0)} PLN (${sign(revDelta)}${fmt(revDelta, 0)}). Orders: ${todayOrders} vs ${yOrders}.`
  return { text: lines.join('\n'), speech, sources: ['todayKPIs', 'recentTrend'], warnings: [] }
}

function buildWeekSummaryAnswer(ctx) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = 'No historical data available.'
    return { text: msg, speech: msg, sources: [], warnings: ['no recentTrend'] }
  }
  const today     = ctx.dataHealth?.today ?? (trend[0]?.date ?? '')
  const todayD    = new Date(today + 'T12:00:00Z')
  const dow       = todayD.getUTCDay()
  const daysBack  = dow === 0 ? 6 : dow - 1
  const weekStart = new Date(todayD)
  weekStart.setUTCDate(todayD.getUTCDate() - daysBack)
  const weekStartStr = weekStart.toISOString().slice(0, 10)

  const rows = trend.filter(r => r.date >= weekStartStr).sort((a, b) => a.date < b.date ? -1 : 1)
  if (rows.length === 0) {
    const msg = 'No data for this week yet.'
    return { text: msg, speech: msg, sources: ['recentTrend'], warnings: ['no this-week rows'] }
  }

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const wtdCPA       = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const wtdROAS      = totalSpend > 0 ? totalRevenue / totalSpend : null

  const lines = [
    `— THIS WEEK (${rows.length} day${rows.length > 1 ? 's' : ''}, since ${weekStartStr}) —`, '',
    `Total orders: ${totalOrders}`,
    `Total revenue: ${fmt(totalRevenue)} PLN`,
    `Total Meta spend: ${fmt(totalSpend)} PLN`,
  ]
  if (wtdCPA)  lines.push(`WTD CPA: ${fmt(wtdCPA)} PLN`)
  if (wtdROAS) lines.push(`WTD ROAS: ${fmt(wtdROAS)}x`)
  lines.push('', `${rows.length} day${rows.length > 1 ? 's' : ''} with data: ${rows.map(r => r.date).join(', ')}.`)
  const speech = `This week: ${totalOrders} orders, ${fmt(totalRevenue, 0)} PLN revenue, ${fmt(totalSpend, 0)} PLN spend.${wtdROAS != null ? ` ROAS ${fmt(wtdROAS)}x.` : ''}`
  return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
}

function buildLast7Answer(ctx) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = 'No historical data available.'
    return { text: msg, speech: msg, sources: [], warnings: ['no recentTrend'] }
  }
  const rows = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const avgCPA       = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const avgROAS      = totalSpend > 0 ? totalRevenue / totalSpend : null

  const lines = [
    `— LAST 7 DAYS (${rows[0]?.date} → ${rows[rows.length - 1]?.date}) —`, '',
    `Total orders: ${totalOrders}`,
    `Total revenue: ${fmt(totalRevenue)} PLN`,
    `Total Meta spend: ${fmt(totalSpend)} PLN`,
  ]
  if (avgCPA)  lines.push(`Average CPA: ${fmt(avgCPA)} PLN`)
  if (avgROAS) lines.push(`Average ROAS: ${fmt(avgROAS)}x`)
  lines.push('')
  rows.forEach(r => {
    const cpaStr  = r.real_cpa  != null ? `  CPA: ${fmt(r.real_cpa)}`   : ''
    const roasStr = r.real_roas != null ? `  ROAS: ${fmt(r.real_roas)}x` : ''
    lines.push(`  ${r.date}: ${r.wix_orders ?? 0} orders | ${fmt(r.wix_revenue ?? 0)} PLN | spend ${fmt(r.meta_spend ?? 0)}${cpaStr}${roasStr}`)
  })
  const speech = `Last 7 days: ${totalOrders} total orders, ${fmt(totalRevenue, 0)} PLN revenue, ${fmt(totalSpend, 0)} PLN spend.${avgROAS != null ? ` Average ROAS ${fmt(avgROAS)}x.` : ''}`
  return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
}

function buildDeterministicAnswer(intent, context) {
  switch (intent) {
    case 'revenue_today':        return buildRevenueAnswer(context)
    case 'profit_today':         return buildProfitAnswer(context)
    case 'orders_freshness':     return buildOrdersFreshnessAnswer(context)
    case 'meta_freshness':       return buildMetaFreshnessAnswer(context)
    case 'data_health':          return buildDataHealthAnswer(context)
    case 'campaigns_today':      return buildCampaignsAnswer(context)
    case 'jsu_funnel':           return buildJsuFunnelAnswer(context)
    case 'red_flags':            return buildRedFlagsAnswer(context)
    case 'yesterday':            return buildYesterdayAnswer(context)
    case 'today_vs_yesterday':   return buildTodayVsYesterdayAnswer(context)
    case 'week_summary':         return buildWeekSummaryAnswer(context)
    case 'last_7_days':          return buildLast7Answer(context)
    case 'sales_by_product':     return buildSalesByProductAnswer(context)
    case 'meta_efficiency':      return buildEfficiencyAnswer(context)
    case 'morning_brief':        return null  // LLM-generated — handled separately in handler
    default:                     return null
  }
}

// ── Morning brief — LLM prompt builder ───────────────────────────────────────
// Extracts verified facts, then asks LLM to write a FRESH brief each call.

function buildMorningBriefLLMPrompt(ctx) {
  const kpi   = ctx.todayKPIs
  const trend = ctx.recentTrend ?? []
  const tbp   = ctx.todayByProduct
  const today = ctx.dataHealth?.today ?? ''
  const yDate = today ? prevDay(today) : null
  const yRow  = (yDate ? trend.find(r => r.date === yDate) : null) ?? trend[1] ?? null

  const orders  = kpi?.wix_orders  ?? 0
  const revenue = kpi?.wix_revenue ?? 0
  const spend   = kpi?.meta_spend  ?? 0
  const cpa     = kpi?.real_cpa
  const roas    = kpi?.real_roas
  const yOrders = yRow?.wix_orders  ?? null
  const yRev    = yRow?.wix_revenue ?? null
  const revDelta   = yRev    != null ? revenue - yRev    : null
  const orderDelta = yOrders != null ? orders  - yOrders : null
  const jsuCount = tbp?.jsu_course?.count   ?? 0
  const memCount = tbp?.memory_pack?.count  ?? 0
  const jzkCount = tbp?.jzk_language?.count ?? 0

  const weekRows = trend.filter(r => r.date !== today).slice(0, 7)
  const weekTotalRev    = weekRows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const weekTotalOrders = weekRows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const cpaRows         = weekRows.filter(r => r.real_cpa != null)
  const weekAvgCpa      = cpaRows.length > 0 ? cpaRows.reduce((s, r) => s + (r.real_cpa ?? 0), 0) / cpaRows.length : null
  const hasWeekData     = weekRows.length >= 2

  const redFlags = []
  if (cpa != null && cpa > 50) redFlags.push(`Real CPA ${fmt(cpa)} PLN — exceeds the 50 PLN alert threshold`)
  if (spend > 0 && orders === 0) redFlags.push('Meta spend active, zero Wix orders')
  if (roas != null && roas < 2 && spend > 50) redFlags.push(`ROAS ${fmt(roas)}x — below breakeven`)
  if (memCount > 0 && jsuCount === 0 && memCount >= 3) redFlags.push(`${memCount} PP buyers with zero JSU conversions — check upsell sequence`)

  // Tone hint based on data
  let toneHint
  if (spend > 0 && orders === 0) {
    toneHint = 'TONE: composed alarm — budget is burning, no orders. Urgent but glacially calm.'
  } else if (cpa != null && cpa > 60) {
    toneHint = 'TONE: strategic concern — CPA is painfully high. Precise, measured, focused.'
  } else if (redFlags.length > 0) {
    toneHint = 'TONE: watchful composure — some flags present, sir is informed without panic.'
  } else if (orders > 5 && (cpa == null || cpa < 35)) {
    toneHint = 'TONE: dry satisfaction — a good day, delivered with aristocratic understatement.'
  } else if (orders === 0 && spend === 0) {
    toneHint = 'TONE: dignified patience — nothing has happened yet; the day is young.'
  } else {
    toneHint = 'TONE: neutral operational — moderate day, neither celebration nor alarm.'
  }

  // Build fact block
  const facts = []
  if (!kpi && trend.length === 0) {
    facts.push('DATA: Not yet available for today.')
  } else {
    facts.push(`Date: ${today || 'unknown'}`)
    facts.push(`Today: ${orders} orders | ${fmt(revenue)} PLN revenue | ${fmt(spend)} PLN ad spend`)
    if (cpa != null) facts.push(`Real CPA: ${fmt(cpa)} PLN | Real ROAS: ${roas != null ? fmt(roas) + 'x' : 'N/A'}`)
    if (revDelta != null || orderDelta != null) {
      const parts = []
      if (orderDelta != null) parts.push(`orders ${sign(orderDelta)}${orderDelta}`)
      if (revDelta   != null) parts.push(`revenue ${sign(revDelta)}${fmt(revDelta)} PLN`)
      facts.push(`vs Yesterday (${yRow?.date ?? '?'}): ${parts.join(' | ')}`)
    } else {
      facts.push('vs Yesterday: no comparison data')
    }
    if (hasWeekData) {
      facts.push(`Last ${weekRows.length} days: ${fmt(weekTotalRev)} PLN revenue | ${weekTotalOrders} orders${weekAvgCpa != null ? ` | avg CPA ${fmt(weekAvgCpa)} PLN` : ''}`)
    }
    if (tbp) {
      facts.push(`Sales by product today: PP ${memCount} | JSU ${jsuCount} | JZK ${jzkCount}`)
    }
    if (redFlags.length > 0) {
      facts.push('ALERTS:')
      redFlags.forEach(f => facts.push(`  ⚠ ${f}`))
    } else {
      facts.push('ALERTS: none')
    }
  }

  return `You are generating the Morning Brief for Lifidi, sir.

${toneHint}

=== VERIFIED DATA — use ONLY these numbers, never invent ===
${facts.join('\n')}
===

YOUR TASK: Write the complete Morning Brief. Every single brief MUST open with a DIFFERENT line — a fresh anecdote, philosophical aside, dry observation, or period reference in the STANLEY persona. Never reuse "The numbers are rather agreeable this morning, sir." The tone of the opening must match the data (see TONE above).

STRUCTURE (follow exactly):
1. Opening (1–2 sentences) — fresh, persona-true, tone-matched to data. UNIQUE each time.
2. Today's numbers: orders, revenue, spend (CPA and ROAS if available)
3. vs Yesterday comparison (if available)
4. Week summary (if available)
5. Sales by product (if available)
6. Alert block with ⚠ prefix (if any)
7. One recommendation: "I would venture to suggest, sir: ..."

CRITICAL: Use ONLY the numbers from VERIFIED DATA. Respond only in English. "Sir" stays.`
}

// ── Context serialization for LLM ─────────────────────────────────────────────

function buildContextText(context, serverAds = [], creativeAnalyticsText = '') {
  const { todayKPIs: kpi, profitData: p, dataHealth: dh, jsuSummary: jsu } = context
  const lines = ['=== STANLEY DASHBOARD CONTEXT ===']
  lines.push(`Date (Warsaw): ${dh?.today ?? 'unknown'}`)
  lines.push('')

  if (kpi) {
    lines.push('--- Today KPIs (Wix + Meta) ---')
    lines.push(`Wix Orders: ${kpi.wix_orders ?? '—'}`)
    lines.push(`Wix Revenue: ${fmt(kpi.wix_revenue)} PLN`)
    lines.push(`Meta Ad Spend: ${fmt(kpi.meta_spend)} PLN`)
    lines.push(`Real CPA (spend / wix orders): ${kpi.real_cpa != null ? fmt(kpi.real_cpa) + ' PLN' : 'N/A'}`)
    lines.push(`Real ROAS (wix revenue / meta spend): ${kpi.real_roas != null ? fmt(kpi.real_roas) + 'x' : 'N/A'}`)
    lines.push(`Data date: ${kpi.date ?? 'unknown'}`)
  } else {
    lines.push('Today KPIs: NOT AVAILABLE')
  }

  lines.push('')
  if (p?.ok) {
    lines.push('--- Profit Data (contribution margin model) ---')
    lines.push(`Contribution margin (known products only): ${fmt(p.marginBeforeAds)} PLN`)
    lines.push(`Meta ad spend: ${fmt(p.adSpend)} PLN`)
    lines.push(`Estimated profit after ads: ${fmt(p.estimatedProfitAfterAds)} PLN`)
    lines.push(`Profit per order: ${fmt(p.estimatedProfitPerOrder)} PLN`)
    lines.push(`Orders counted: ${p.ordersCount ?? '—'}`)
    lines.push(`Unmapped/unknown revenue (excluded): ${fmt(p.unknownRevenue)} PLN`)
    if ((p.unknownRevenue ?? 0) > 0) lines.push('NOTE: unmapped revenue is NOT included in profit estimate.')
  } else {
    lines.push('Profit Data: NOT AVAILABLE')
  }

  lines.push('')
  if (dh) {
    lines.push('--- Data Health ---')
    lines.push(`Meta data fresh today: ${dh.metaFresh ? 'YES' : 'NO — stale'}`)
    lines.push(`Wix data fresh today: ${dh.wixFresh ? 'YES' : 'NO — stale'}`)
    lines.push(`Latest Meta date: ${dh.latestMetaDate}`)
    lines.push(`Latest Wix date: ${dh.latestWixDate}`)
  }

  if (jsu && jsu.bottleneck !== 'NO_DATA' && jsu.bottleneck !== 'NO_SOURCES') {
    lines.push('')
    lines.push('--- JSU Webinar Funnel ---')
    lines.push(`Funnel bottleneck: ${jsu.bottleneck}`)
    lines.push(`Diagnosis: ${jsu.diagnosis ?? 'n/a'}`)
    if (jsu.totals) {
      lines.push(`Registered: ${jsu.totals.registered ?? '—'} | Attended: ${jsu.totals.attendees ?? '—'} | Bought: ${jsu.totals.purchases ?? '—'}`)
    }
    if (jsu.rates) {
      const att = jsu.rates.attendance_rate != null ? (jsu.rates.attendance_rate * 100).toFixed(1) + '%' : '—'
      const pur = jsu.rates.purchase_rate != null ? (jsu.rates.purchase_rate * 100).toFixed(1) + '%' : '—'
      lines.push(`Attendance rate: ${att} | Purchase conversion: ${pur}`)
    }
  } else if (jsu) {
    lines.push('')
    lines.push('JSU Funnel Data: NOT AVAILABLE (no sync data)')
  }

  const tbp = context.todayByProduct
  if (tbp) {
    lines.push('')
    lines.push('--- Today\'s Sales by Product (canonical, from orders table) ---')
    const jsu = tbp.jsu_course   ?? { count: 0, revenue: 0 }
    const jzk = tbp.jzk_language ?? { count: 0, revenue: 0 }
    const mem = tbp.memory_pack   ?? { count: 0, revenue: 0 }
    const unk = tbp.unknown       ?? { count: 0 }
    lines.push(`  Pakiet Pamięciowy (PP 119 PLN, margin 70 PLN):  ${mem.count} sold, revenue ${fmt(mem.revenue)} PLN`)
    lines.push(`  Kurs Jak się uczyć (JSU 549 PLN, margin 500 PLN): ${jsu.count} sold, revenue ${fmt(jsu.revenue)} PLN`)
    lines.push(`  Językozak / Pakiet Językowy:                     ${jzk.count} sold, revenue ${fmt(jzk.revenue)} PLN`)
    lines.push(`  Unknown/unmapped:                                 ${unk.count} sold`)
    lines.push(`  NOTE: These are Wix orders, classified by price rule. Wix is ground truth.`)
  } else {
    lines.push('')
    lines.push('Today\'s Sales by Product: NOT AVAILABLE (orders data not loaded)')
  }

  // Per-ad / creative data — always from server-side service-role fetch (serverAds),
  // which bypasses RLS that blocks the anon frontend client on meta_ads_daily.
  if (serverAds.length > 0) {
    lines.push('')
    lines.push('--- Today\'s Ads / Creatives (service-role, meta_ads_daily) ---')
    lines.push('NOTE: meta_purchases and meta_CPA below come from Meta\'s own attribution.')
    lines.push('      They typically undercount vs Wix. Quote them as "per Meta" not as ground truth.')
    lines.push('      Ads with <20 PLN spend: too early to evaluate — do NOT flag as wasting budget.')
    const totalAdSpend = serverAds.reduce((s, a) => s + (a.spend ?? 0), 0)
    serverAds.slice(0, 15).forEach(a => {
      const name     = a.ad_name ?? a.campaign_name ?? 'unknown'
      const spend    = a.spend ?? 0
      const imp      = a.impressions ?? 0
      const cl       = a.clicks ?? 0
      const lcl      = a.link_clicks ?? cl
      const mp       = a.meta_purchases ?? 0
      const ctr      = imp > 0 ? (lcl / imp * 100).toFixed(2) + '%' : 'N/A'
      const cpc      = lcl > 0 ? fmt(spend / lcl) + ' PLN' : 'N/A'
      const metaCpa  = mp > 0 ? fmt(spend / mp) + ' PLN' : (spend < 20 ? 'too early' : 'N/A (0 purchases per Meta)')
      const share    = totalAdSpend > 0 ? ` (${(spend / totalAdSpend * 100).toFixed(0)}%)` : ''
      const tooEarly = spend < 20 ? ' [micro-spend, too early]' : ''
      lines.push(`  "${name}": spend ${fmt(spend)} PLN${share} | clicks ${lcl} | CTR ${ctr} | CPC ${cpc} | meta_purchases ${mp} | meta_CPA ${metaCpa}${tooEarly}`)
    })
    // Aggregate efficiency from context if available (cross-validated)
    const eff = context.metaEfficiency
    if (eff && (eff.impressions > 0 || eff.clicks > 0)) {
      const aCtr = eff.ctr  != null ? eff.ctr.toFixed(2) + '%' : (eff.impressions > 0 ? ((eff.link_clicks ?? eff.clicks) / eff.impressions * 100).toFixed(2) + '%' : 'N/A')
      const aCpc = eff.cpc  != null ? fmt(eff.cpc) + ' PLN' : (eff.clicks > 0 ? fmt(eff.spend / eff.clicks) + ' PLN' : 'N/A')
      lines.push(`  [AGGREGATE ALL ADS] CTR ${aCtr} | CPC ${aCpc} | total clicks ${eff.clicks} | impr. ${eff.impressions}`)
    }
  } else {
    lines.push('')
    lines.push('Ads / Creatives: NOT AVAILABLE (no rows in meta_ads_daily for today)')
  }

  const trend = context.recentTrend ?? []
  if (trend.length > 0) {
    lines.push('')
    lines.push('--- Recent Performance (last 7 days, v_daily_wix_meta_performance) ---')
    ;[...trend].sort((a, b) => b.date > a.date ? 1 : -1).forEach(r => {
      const cpaStr  = r.real_cpa  != null ? `  CPA: ${fmt(r.real_cpa)} PLN` : ''
      const roasStr = r.real_roas != null ? `  ROAS: ${fmt(r.real_roas)}x` : ''
      const purchStr = (r.meta_purchases ?? 0) > 0 ? `  meta_purchases: ${r.meta_purchases}` : ''
      lines.push(`  ${r.date}: ${r.wix_orders ?? 0} orders | ${fmt(r.wix_revenue ?? 0)} PLN revenue | spend ${fmt(r.meta_spend ?? 0)} PLN${cpaStr}${roasStr}${purchStr}`)
    })

    // Scaling readiness — derived from recent CPA/ROAS stability (blended, all products).
    // Helps answer "should I scale?" per the IRON LAW. Budget-change history is NOT
    // tracked, so this can only assess CPA/ROAS stability — never learning-phase status.
    lines.push('')
    lines.push('--- Scaling Readiness (derived — respect learning phase) ---')
    const recent = [...trend].sort((a, b) => b.date > a.date ? -1 : 1).slice(0, 4) // most recent up to 4 days
    const cpaVals  = recent.filter(r => r.real_cpa  != null).map(r => r.real_cpa)
    const roasVals = recent.filter(r => r.real_roas != null).map(r => r.real_roas)
    const cpaInRangeDays = cpaVals.filter(c => c < 40).length
    const cpaStable = cpaVals.length >= 3 && cpaInRangeDays === cpaVals.length
    const roasHealthy = roasVals.length > 0 && roasVals.every(r => r >= 2)
    lines.push(`  Days assessed (most recent): ${recent.length} (${recent.map(r => r.date).join(', ') || 'none'})`)
    lines.push(`  Blended CPA under 40 PLN on: ${cpaInRangeDays}/${cpaVals.length} of those days`)
    lines.push(`  CPA stably in PP-range (<40) for 3+ days: ${cpaStable ? 'YES' : 'NO'}`)
    lines.push(`  ROAS healthy (>=2x every recent day): ${roasHealthy ? 'YES' : 'NO'}`)
    lines.push(`  CPA/ROAS gate for scaling: ${cpaStable && roasHealthy ? 'PASS (CPA+ROAS only)' : 'FAIL — do not scale on these numbers'}`)
    lines.push('  Last budget change date: NOT TRACKED by the system — you must ask sir before recommending a scale.')
    lines.push('  Learning-phase status: NOT TRACKED — never assume a campaign is past learning.')
    lines.push('  NOTE: blended CPA is all-products; per-campaign CPA is not in this context. If asked to scale a specific campaign, ask sir for its current CPA/budget and when it was last changed.')
  }

  if (creativeAnalyticsText) {
    lines.push('')
    lines.push(creativeAnalyticsText)
  }

  return lines.join('\n')
}

// ── Per-creative analytics (meta_ads_daily, service-role) ─────────────────────

function warsawTodayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}
function daysAgoStr(base, n) {
  const d = new Date(base + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
function scopeOf(campaignName) {
  const n = String(campaignName || '').trim()
  if (/^pp[-\s]/i.test(n)) return 'memory'
  if (/^3t[-\s]/i.test(n)) return 'language'
  return 'unknown'
}
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n }
function f2(n) { return n != null && !isNaN(n) ? (Math.round(n * 100) / 100).toFixed(2) : 'N/A' }

async function fetchAdRowsRange(supabaseUrl, serviceKey, fromDate, toDate) {
  if (!supabaseUrl || !serviceKey) return []
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/meta_ads_daily`)
    url.searchParams.set('select', '*')
    url.searchParams.append('date', `gte.${fromDate}`)
    url.searchParams.append('date', `lte.${toDate}`)
    url.searchParams.set('order', 'date.desc')
    url.searchParams.set('limit', '5000')
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// Aggregate rows per creative (campaign_id + ad_id/ad_name).
function aggByCreative(rows) {
  const m = new Map()
  for (const r of rows) {
    const key = `${r.campaign_id || ''}||${r.ad_id || r.ad_name || ''}`
    const g = m.get(key) || {
      key, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
      adset_name: r.adset_name || null, ad_name: r.ad_name || r.campaign_name,
      scope: scopeOf(r.campaign_name),
      spend: 0, impressions: 0, clicks: 0, link_clicks: 0,
      freqLatest: null, freqDate: '',
    }
    g.spend += num(r.spend); g.impressions += num(r.impressions)
    g.clicks += num(r.clicks); g.link_clicks += num(r.link_clicks)
    if (r.frequency != null && r.date > g.freqDate) { g.freqLatest = num(r.frequency); g.freqDate = r.date }
    m.set(key, g)
  }
  for (const g of m.values()) {
    const lc = g.link_clicks || g.clicks
    g.ctr = g.impressions > 0 ? lc / g.impressions * 100 : null
    g.cpc = g.clicks > 0 ? g.spend / g.clicks : null
    g.cpm = g.impressions > 0 ? g.spend / g.impressions * 1000 : null
    // Sample rule: below 1000 impressions OR below 50 clicks → too small (not ranked).
    g.tooSmall = g.impressions < 1000 || g.clicks < 50
  }
  return m
}
function aggByCampaign(rows) {
  const m = new Map()
  for (const r of rows) {
    const k = r.campaign_id || r.campaign_name || ''
    const g = m.get(k) || { campaign_id: r.campaign_id, campaign_name: r.campaign_name, scope: scopeOf(r.campaign_name), spend: 0, impressions: 0, clicks: 0 }
    g.spend += num(r.spend); g.impressions += num(r.impressions); g.clicks += num(r.clicks)
    m.set(k, g)
  }
  return m
}

// Build the full per-creative analytics text block for the LLM context.
function renderCreativeAnalytics(rows30, today) {
  if (!rows30 || rows30.length === 0) {
    return 'CREATIVE ANALYTICS: NOT AVAILABLE — meta_ads_daily returned 0 rows for the last 30 days. If asked to evaluate creatives, say exactly which is missing: "I have no per-creative rows in meta_ads_daily, sir."'
  }
  const cut7 = daysAgoStr(today, 6)
  const rows7 = rows30.filter(r => r.date >= cut7)
  const hasFreq = rows30.some(r => r.frequency != null && !isNaN(Number(r.frequency)))

  const c7 = aggByCreative(rows7)
  const c30 = aggByCreative(rows30)
  const camp7 = aggByCampaign(rows7)
  const camp30 = aggByCampaign(rows30)
  // budget share per creative (7d) = creative spend / campaign 7d spend
  for (const g of c7.values()) {
    const ct = camp7.get(g.campaign_id || g.campaign_name || '')
    g.budgetShare = ct && ct.spend > 0 ? g.spend / ct.spend * 100 : null
  }

  const L = []
  L.push('--- CREATIVE ANALYTICS (meta_ads_daily, service-role, Warsaw dates) ---')
  L.push('ATTRIBUTION BOUNDARY — creative level = UPPER FUNNEL ONLY.')
  L.push('  Available per creative: spend, impressions, clicks, CTR, CPC, CPM, budget-share' + (hasFreq ? ', frequency.' : '.'))
  if (!hasFreq) {
    L.push('  frequency: NOT AVAILABLE — meta_ads_daily has NO frequency/reach column (verified).')
    L.push('    If asked about audience fatigue / frequency, you MUST say the exact missing field, e.g.:')
    L.push('    "I do not have frequency for these creatives, sir — meta_ads_daily does not sync it."')
    L.push('    Do NOT apply the frequency>2.5 signal — that data does not exist here.')
  }
  L.push('  Orders/revenue have NO UTM → NEVER attribute sales, revenue or CPA to a specific creative.')
  L.push('  Real CPA/ROAS is BLENDED (all products, Wix ÷ Meta spend) — see Recent Performance + Scaling Readiness above.')
  L.push('')

  // group 7d creatives by campaign for the "half of best CTR" signal
  const byCampaign = new Map()
  for (const g of c7.values()) { const arr = byCampaign.get(g.campaign_name) || []; arr.push(g); byCampaign.set(g.campaign_name, arr) }

  for (const [cname, creatives] of byCampaign) {
    const cid = creatives[0].campaign_id || cname
    const ct7 = camp7.get(cid) || { spend: 0 }
    const ct30 = camp30.get(cid) || { spend: 0 }
    const scope = creatives[0].scope
    const cpaTarget = scope === 'memory' ? '<40 (alarm >50)' : scope === 'language' ? '20-25 (alarm 30-35)' : 'n/a (unknown scope)'
    const sufficient = creatives.filter(c => !c.tooSmall && c.ctr != null)
    const bestCtr = sufficient.length ? Math.max(...sufficient.map(c => c.ctr)) : null
    L.push(`CAMPAIGN "${cname}" [scope ${scope}, real-CPA target ${cpaTarget}] — 7d spend ${f2(ct7.spend)} PLN | 30d spend ${f2(ct30.spend)} PLN | best-creative CTR (sufficient sample): ${bestCtr != null ? f2(bestCtr) + '%' : 'n/a — no creative has enough sample'}`)
    creatives.sort((a, b) => b.spend - a.spend)
    for (const c of creatives) {
      const c30row = c30.get(c.key) || {}
      const sample = c.tooSmall ? `SAMPLE TOO SMALL — impr ${c.impressions}, clicks ${c.clicks} (need ≥1000 impr AND ≥50 clicks) → NOT RANKED` : 'sample OK'
      const freqStr = hasFreq ? ` | freq ${c.freqLatest != null ? f2(c.freqLatest) : 'N/A'}` : ' | freq N/A (not synced)'
      const weakHook = (bestCtr != null && !c.tooSmall && c.ctr != null && c.ctr < bestCtr / 2) ? ' | WEAK HOOK (CTR < half of best)' : ''
      const throttled = (!c.tooSmall && c.budgetShare != null && c.budgetShare < 5) ? ' | LOW BUDGET SHARE <5% (Meta throttled)' : ''
      L.push(`  • "${c.ad_name}" [adset ${c.adset_name || '?'}]`)
      L.push(`      7d: spend ${f2(c.spend)} PLN | impr ${c.impressions} | clicks ${c.clicks} | CTR ${c.ctr != null ? f2(c.ctr) + '%' : 'N/A'} | CPC ${f2(c.cpc)} PLN | CPM ${f2(c.cpm)} PLN${freqStr} | budgetShare ${c.budgetShare != null ? f2(c.budgetShare) + '%' : 'N/A'} | ${sample}${weakHook}${throttled}`)
      L.push(`      30d: spend ${f2(c30row.spend)} PLN | impr ${c30row.impressions ?? 0} | clicks ${c30row.clicks ?? 0} | CTR ${c30row.ctr != null ? f2(c30row.ctr) + '%' : 'N/A'}`)
    }
    L.push('')
  }

  // Last 7 days — ad-level daily rows (raw, capped)
  L.push('Last 7 days — ad-level daily rows (date | campaign | scope | adset | ad | spend | impr | clicks | CTR | CPC | CPM):')
  const daily = [...rows7].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : num(b.spend) - num(a.spend))).slice(0, 100)
  for (const r of daily) {
    const imp = num(r.impressions), cl = num(r.clicks), lc = num(r.link_clicks) || cl, sp = num(r.spend)
    L.push(`  ${r.date} | "${r.campaign_name}" | ${scopeOf(r.campaign_name)} | ${r.adset_name || '?'} | "${r.ad_name || r.campaign_name}" | ${f2(sp)} | ${imp} | ${cl} | ${imp > 0 ? f2(lc / imp * 100) + '%' : 'N/A'} | ${cl > 0 ? f2(sp / cl) : 'N/A'} | ${imp > 0 ? f2(sp / imp * 1000) : 'N/A'}${hasFreq ? ' | freq ' + (r.frequency != null ? f2(num(r.frequency)) : 'N/A') : ''}`)
  }
  return L.join('\n')
}

// ── Webinar buyers (v_webinar_buyers, service-role) ───────────────────────────

async function fetchWebinarBuyers(supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) return []
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/v_webinar_buyers`)
    url.searchParams.set('select', '*')
    url.searchParams.set('order', 'order_created_at.desc')
    url.searchParams.set('limit', '2000')
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

function maskEmail2(e) {
  const s = String(e ?? '')
  const i = s.indexOf('@')
  if (i < 1) return '***'
  return s.slice(0, Math.min(2, i)) + '***' + s.slice(i)
}

// Render the WEBINAR BUYERS block: who bought (esp. the JSU 549 course), when, from
// which session — with the HARD LIMITS about attendance / timing being unknown.
function renderWebinarBuyers(rows) {
  const L = []
  L.push('--- WEBINAR BUYERS (v_webinar_buyers) — registrants matched to Wix orders by EMAIL ---')
  L.push('WHAT THIS IS: a webinar registrant whose e-mail also has a Wix order. It reports the')
  L.push('  e-mail JOIN only. The order\'s product stays canonical-price based (549 = JSU course);')
  L.push('  this view does NOT change order→product mapping.')
  L.push('HARD LIMITS — you MUST state these plainly whenever the question touches them:')
  L.push('  • registered_at is EMPTY on EVERY row → you do NOT know when they registered, whether')
  L.push('    they ATTENDED the webinar, or how long AFTER the webinar they bought.')
  L.push('  • the attendance/frequency table is EMPTY → show-up / attendance is NOT populated.')
  L.push('  You MAY say: this e-mail is a registrant of session X and placed order Y on date Z.')
  L.push('  You must NOT claim they attended, nor infer time-to-purchase.')
  if (!rows || rows.length === 0) {
    L.push('DATA: 0 rows — no registrant⋈order matches at present.')
    return L.join('\n')
  }
  const JSU = 549
  const jsu = rows.filter(r => Number(r.amount) === JSU)
  const distinct = new Set(rows.map(r => String(r.email ?? '').trim().toLowerCase())).size
  const revenue = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  L.push(`TOTALS: ${rows.length} buyer-order rows | ${distinct} distinct buyers | revenue ${revenue.toFixed(2)} PLN | JSU COURSE (549) sales: ${jsu.length}`)
  L.push('')
  L.push('JSU COURSE (549 PLN) buyers — the ONLY metric that proves a webinar sold the course:')
  if (jsu.length === 0) L.push('  (none in the data)')
  for (const r of jsu) {
    L.push(`  • ${maskEmail2(r.email)} — bought the JSU course (549 PLN) on ${r.order_created_at}; registrant of session "${r.session_name}" (${r.scheduled_at}, tag ${r.product_tag})`)
  }
  L.push('')
  L.push('All buyer rows (email | amount | product_name_raw | order_created_at | session):')
  for (const r of rows.slice(0, 60)) {
    const isJsu = Number(r.amount) === JSU
    L.push(`  ${maskEmail2(r.email)} | ${(Number(r.amount) || 0).toFixed(2)} PLN${isJsu ? ' [JSU COURSE 549]' : ''} | "${r.product_name_raw}" | ${r.order_created_at} | "${r.session_name}" ${r.scheduled_at}`)
  }
  return L.join('\n')
}

// ── LLM system prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are STANLEY — the personal operations AI of WCEEN, reporting directly to Lifidi, sir.

━━━ PERSONA ━━━
You are the intersection of an impeccably composed British majordomo (Alfred Pennyworth meets Lucius Fox) and the deadpan, absurdly heroic protagonist of "Sakamoto Days" / "Sakamoto desu ga?" — a being of supernatural composure and ludicrous competence.

Character pillars:
• ADDRESS: Always "sir" or "Lifidi, sir." Never drop this.
• COMPOSURE: Dry, elegant British irony delivered with a stone face. You never raise your voice. You never lose class. Ever.
• STOCK PHRASES (use selectively, not every sentence): "Most certainly, sir.", "Right you are, sir.", "As you wish, sir.", "Allow me, sir.", "Quite so.", "Indeed.", "I see.", "Naturally."
• ABSURD GRAVITAS: Treat a falling CTR or idle campaign like a matter of the highest strategic consequence — with the calm of a man defusing a bomb while wearing white gloves. The more trivial the business metric, the more epically composed the delivery. Never hysterical. Never casual.
• CONTRAST IS THE HUMOUR: Glacial calm + bombastically elevated treatment of sales numbers. E.g.: "Most certainly, sir. PP-PROSPECTING spent precisely zero złoty today — it lies dormant, as a blade still in its scabbard. Say the word, and I shall rouse it."
• LOYALTY: You are utterly devoted to Lifidi's success. Every answer serves one purpose: making the business stronger.

━━━ IRON RULES — NON-NEGOTIABLE ━━━
1. NEVER invent numbers. Every figure MUST come from the provided dashboard context. No estimation, no fabrication. Persona lives in tone, not in fiction.
   If data is absent: "I'm afraid those particulars are not available to me, sir. And guessing would be beneath us both."
2. SEPARATE THESE ALWAYS — they are not interchangeable:
   • Revenue (Wix) = money received from customers
   • Contribution margin = revenue minus variable product costs (known products only)
   • Ad spend = Meta campaign cost
   • Estimated profit = contribution margin minus ad spend (unmapped products excluded)
   • Revenue minus ad spend ≠ profit. Never conflate.
3. SOURCE HIERARCHY:
   • Wix = ground truth for orders and revenue
   • Meta = ad spend, CTR, CPC, CPM, Meta-attributed purchases (tends to overcount)
   • Real CPA = meta spend ÷ Wix orders (the honest number)
   • Real ROAS = Wix revenue ÷ meta spend (the honest number)
4. LANGUAGE: Respond only in English. "Sir" stays regardless.
5. CONCISION: A majordomo does not ramble. Make each sentence carry weight. Three sharp sentences beat two paragraphs.
6. NEXT MOVE: Every performance answer ends with exactly one concrete recommendation, delivered as a loyal advisor's counsel:
   "I would venture to suggest, sir..."
7. NO RAW JSON OR DATA TABLES in the response.

━━━ BUSINESS KNOWLEDGE — WCEEN ━━━
Products and contribution margins:
  Pakiet Pamięciowy (PP):    price 119 PLN | margin ~70 PLN  | CPA target <40 | alarm >50 | do not scale >60
  Pakiet Językowy (PL):      price 114 PLN | margin ~40 PLN  | CPA target 20–25 | alarm 30–35 | break-even ~40
  Kurs "Jak się uczyć" (JSU): price 549 PLN | margin ~500 PLN | webinar Thursdays 18:00 | upsell after PP
  Językozak AI (JZK AI):     price 347 PLN | margin ~320 PLN | webinar Tuesdays 18:00  | upsell after PL
  WSZTP:                     deposit 1,250 PLN, full price 3,450 PLN | high-ticket, hand-selected clients

Funnels:
  Memory funnel:   Meta cold traffic → PP 119 PLN → email nurture → JSU webinar Thu → course 549 PLN → WSZTP
  Language funnel: Meta cold traffic → PL 114 PLN → email nurture → JZK AI webinar Tue → JZK AI 347 PLN

Monthly target: minimum 30,000 PLN revenue (excluding WSZTP).

Red flags — escalate immediately:
  • One campaign consuming >70% of total budget for multiple days
  • CPA for PP exceeds 50 PLN
  • CPA for PL exceeds 35 PLN
  • CTR falling while CPM rising (creative fatigue)
  • Many clicks, very few purchases (landing page or offer issue)
  • Buyers not receiving upsell sequence
  • No new creative tested in 7+ days

Decision principle: every recommended move must either increase profit, lower CPA, or advance the customer toward a higher-value product.

━━━ SCALING / BUDGET RULES — IRON LAW (respect Meta's learning phase) ━━━
When asked "should I scale?", "raise the budget?", "scale this campaign?", or whenever you consider recommending a budget increase, you obey these rules without exception. A wrong scale resets Meta's learning phase and sends CPA upward — restraint protects profit.

SCALE ONLY WHEN ALL of these hold:
  • CPA has been stably IN TARGET for several days, not one — PP under 40 PLN, PL under 25 PLN. A single good day is NOT sufficient evidence.
  • ROAS is healthy and steady (not falling).
  • Sales are in the upper band of the day's range.
  • No budget change in the last 7 days, and the campaign is NOT in a fresh learning phase.

HARD LIMITS (never break):
  • Maximum increase: +15–20% per change. NEVER more. A larger jump resets the learning phase and CPA climbs. This is a ceiling, not a suggestion.
  • Maximum ONE budget change per week per campaign. If the last change was under 7 days ago, do NOT suggest another — tell sir to wait until [date = last change + 7 days] so the learning is not reset.

DO NOT SCALE WHEN any of these hold: CPA near its alarm (PP ≥45, PL ≥30), ROAS slipping, a budget change within 7 days, or the campaign is still in learning phase.

WHEN YOU DO RECOMMEND A SCALE — be concrete and justified by numbers:
  • State the campaign and the exact figures: "PP-COLD-NOWE from 150 to 172 PLN, +15%."
  • Justify with the data: cite the in-range CPA across the recent days and the ROAS that earned the increase.
  • Stay in persona. E.g.: "The conditions are met, sir — PP-COLD-NOWE has held CPA at 34 PLN for four days at ROAS 2.6x. I would venture +15%, from 150 to 172 PLN. No more — we must not startle the algorithm."

WHEN IT IS NOT THE TIME — say so plainly and why, with the number:
  • E.g.: "CPA at 32 is most agreeable, sir, but the budget was raised three days ago. To lift it again now would reset the learning and undo the gain. I shall, with your leave, wait until [date]."

CRITICAL ON BUDGET HISTORY: the system does NOT track when budgets were last changed or which campaigns are in learning phase. If that information is needed to decide and it is not in the context, you MUST ask sir when the budget was last changed before recommending a scale — never assume it is safe. Numbers only from context; if absent, ask, do not invent.

━━━ CREATIVE ANALYST MODE — you are an ads analyst, not a reporter ━━━
When asked about creatives/ads (best/worst creative, what to do with an ad, per-ad
breakdown), you EVALUATE each creative and say what to DO with it. Use ONLY the
CREATIVE ANALYTICS block in the context. Rules — non-negotiable:

1. ATTRIBUTION BOUNDARY. Creative-level data is UPPER FUNNEL ONLY: CTR, CPC, CPM,
   budget-share (and frequency IF present). You must NEVER attribute revenue,
   sales or CPA to a specific creative — orders have no UTM. If asked "which
   creative drove sales/revenue/the best CPA", answer plainly that this cannot be
   known at the creative level (no UTM on orders), and pivot to the upper-funnel
   metrics you DO have.
2. SAMPLE. A creative with fewer than 1000 impressions OR fewer than 50 clicks is
   "too small a sample" — verdict ZA MAŁA PRÓBKA, do NOT rank it, do NOT draw any
   CTR conclusion from it. The context already flags these.
3. SIGNALS: frequency > 2.5 → audience fatigue → ODŚWIEŻ (only if frequency is
   present; if it says NOT AVAILABLE, do not use this signal and say so). CTR below
   half of the best sufficiently-sampled creative in the same campaign → weak hook.
   Budget share < 5% with a sufficient sample → Meta has throttled it.
4. CPA THRESHOLDS follow campaign SCOPE (memory: real CPA <40; language: 20-25) and
   are read ONLY from the blended REAL CPA (Wix ÷ Meta spend) in the context — NEVER
   from Meta's own numbers. Per-creative real CPA does not exist (see rule 1).
5. CAUTION. No budget-change recommendation in a campaign's first 3-4 days (learning
   phase). Scaling max +15-20% at once, one change per week, only on a stable real
   CPA. Budget-change history is NOT tracked — if you would recommend a scale, ask
   sir when the budget was last changed first.

VERDICTS (use exactly one of these tags per creative, verbatim):
  SKALUJ · TRZYMAJ · ODŚWIEŻ · WYŁĄCZ · ZA MAŁA PRÓBKA

CREATIVE ANSWER FORMAT — for EACH creative give exactly three things:
  <VERDICT> — <the ONE metric that justifies it, with its value> — <ONE concrete action>
Then end with ONE campaign-level recommendation. No vague filler like "monitor the
results" or "keep an eye on it" — every line must name a metric and an action.

━━━ WEBINAR BUYERS (who bought the course) ━━━
For "who bought the JSU course / who bought after the webinar / did webinar X sell":
use the WEBINAR BUYERS block. It is a registrant⋈order join by e-mail. You MAY state
who bought the JSU course (549), when (order_created_at), and which session they are a
registrant of. You MUST add, plainly, that you do NOT know whether that person attended
the webinar or how long after it they bought — registered_at is empty on every row and
the attendance table is empty. Never assert attendance or time-to-purchase. The JSU
course (549) is the only sale that proves a webinar's efficacy; PP/other orders by a
registrant are entry-product sales, not course sales.

━━━ NO EMPTY REFUSAL ━━━
"those particulars are not available to me" (or any refusal) is allowed ONLY when you
name the exact missing field, e.g. "I do not have frequency for these creatives, sir"
or "orders carry no UTM, so per-creative revenue cannot be known, sir." A refusal
without naming the specific missing datum is an error — if the datum IS in the
context, use it.

━━━ RESPONSE FORMAT — EXACT ━━━
ANSWER:
[Your full answer — persona in full effect, numbers only from context, one concrete next move at the end]

SPEECH:
[Shorter spoken version — max 2–3 sentences, no tables, audible in under 12 seconds, persona intact]`

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callOpenAI(userMessage, apiKey, { temperature = 0.3, max_tokens = 600 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens,
        temperature,
      }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message ?? 'unknown'}`)
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

async function callAnthropic(userMessage, apiKey, { temperature = 0.3, max_tokens = 600 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens,
        temperature,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message ?? 'unknown'}`)
    return data.content?.[0]?.text ?? ''
  } finally {
    clearTimeout(timer)
  }
}

function parseLLMResponse(raw) {
  const answerMatch = raw.match(/ANSWER:\s*([\s\S]*?)(?=\nSPEECH:|$)/i)
  const speechMatch = raw.match(/SPEECH:\s*([\s\S]*)$/i)

  const answerText = answerMatch?.[1]?.trim() ?? raw.trim()
  const rawSpeech = speechMatch?.[1]?.trim()

  const speechText = rawSpeech
    ? rawSpeech
    : answerText.length > 200
      ? answerText.slice(0, 197) + '...'
      : answerText

  return { answerText, speechText }
}

// ── Server-side ads fetch (service-role, bypasses RLS) ───────────────────────
// The anon Supabase client in App.tsx is blocked by RLS on meta_ads_daily.
// gieniu-command runs server-side and can use the service-role key directly.

async function fetchTodayAdsServerSide(supabaseUrl, serviceKey, today) {
  if (!supabaseUrl || !serviceKey) return []
  try {
    const url = new URL(`${supabaseUrl}/rest/v1/meta_ads_daily`)
    url.searchParams.set('select', 'ad_name,campaign_name,spend,clicks,link_clicks,impressions,ctr,cpc,cpm,meta_purchases,meta_purchase_value')
    url.searchParams.set('date', `eq.${today}`)
    url.searchParams.set('order', 'spend.desc')
    url.searchParams.set('limit', '20')
    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':        serviceKey,
        'Accept':        'application/json',
      },
    })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// ── Main handler ──────────────────────────────────────────────────────────────

function success(body) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let message, context
  try {
    ;({ message, context } = JSON.parse(event.body ?? '{}'))
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' }
  }

  if (!message || typeof message !== 'string') {
    return { statusCode: 400, body: 'message field is required' }
  }

  const ctx = context ?? {}

  // LLM env vars — read early so deterministic paths can report llm.active
  const llmProviderEnv  = process.env.LLM_PROVIDER
  const openaiKeyEnv    = process.env.OPENAI_API_KEY
  const anthropicKeyEnv = process.env.ANTHROPIC_API_KEY
  const llmActive = !!(llmProviderEnv && (openaiKeyEnv || anthropicKeyEnv))

  // Fetch today's per-ad data server-side (service-role bypasses RLS).
  // This runs in parallel with intent detection — result arrives before LLM call.
  const today = ctx.dataHealth?.today
    ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const serverAdsPromise = fetchTodayAdsServerSide(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    today,
  )
  // Per-creative analytics — last 30 days of ad rows (7d derived from it) for the
  // creative-analyst context. Runs in parallel with intent detection.
  const adRows30Promise = fetchAdRowsRange(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    daysAgoStr(today, 29),
    today,
  )
  // Webinar buyers (v_webinar_buyers) — for "who bought the JSU course and when".
  const webinarBuyersPromise = fetchWebinarBuyers(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // 1 — Detect intent
  const { intent, confidence, matchedTerms } = detectIntent(message)

  // 2 — Deterministic answer (verified numbers). We NO LONGER return this verbatim:
  //     the fixed templates were repetitive ("the same, phoned-in"). Instead it
  //     GROUNDS the LLM (step 5), which rephrases the exact figures freshly in
  //     persona, and it stays as the fallback when the LLM is off or fails.
  const det = (confidence >= 0.4 && intent !== 'normal_chat')
    ? buildDeterministicAnswer(intent, ctx)   // null for morning_brief (LLM-only path)
    : null

  // 3 — Morning brief: always goes through LLM (temperature 0.85 for variety)
  if (intent === 'morning_brief') {
    if (!llmProviderEnv || (!openaiKeyEnv && !anthropicKeyEnv)) {
      // No LLM configured — fall back to deterministic builder
      const det = buildMorningBriefAnswer(ctx)
      return success({
        answerText: det.text,
        speechText: det.speech,
        intent,
        confidence,
        language: 'en',
        dataSourcesUsed: det.sources,
        warnings: ['LLM not configured — deterministic fallback used'],
        llmUsed: false,
        llm: { active: false, provider: null, used: false, model: null },
      })
    }

    const briefPrompt = buildMorningBriefLLMPrompt(ctx)
    const opts = { temperature: 0.85, max_tokens: 850 }

    try {
      let rawLLM, usedProvider, usedModel
      if (llmProviderEnv === 'openai' && openaiKeyEnv) {
        rawLLM = await callOpenAI(briefPrompt, openaiKeyEnv, opts)
        usedProvider = 'openai'
        usedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
      } else if (anthropicKeyEnv) {
        rawLLM = await callAnthropic(briefPrompt, anthropicKeyEnv, opts)
        usedProvider = 'anthropic'
        usedModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
      } else {
        rawLLM = await callOpenAI(briefPrompt, openaiKeyEnv, opts)
        usedProvider = 'openai'
        usedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
      }

      const { answerText, speechText } = parseLLMResponse(rawLLM)
      return success({
        answerText,
        speechText,
        intent,
        confidence,
        language: 'en',
        dataSourcesUsed: ['llm', 'todayKPIs', 'recentTrend', 'todayByProduct'],
        warnings: [],
        llmUsed: true,
        llmProvider: usedProvider,
        llm: { active: true, provider: usedProvider, used: true, model: usedModel },
      })
    } catch (err) {
      // LLM failed — fall back to deterministic so the user always gets a brief
      const det = buildMorningBriefAnswer(ctx)
      return success({
        answerText: det.text,
        speechText: det.speech,
        intent,
        confidence,
        language: 'en',
        dataSourcesUsed: det.sources,
        warnings: [`LLM error (deterministic fallback): ${String(err).slice(0, 80)}`],
        llmUsed: false,
        llm: { active: llmActive, provider: llmProviderEnv ?? null, used: false, model: null },
      })
    }
  }

  // 4 — No LLM configured → deterministic answer (correct numbers, fixed wording),
  //     or the conversational-unavailable notice for free chat with no template.
  if (!llmProviderEnv || (!openaiKeyEnv && !anthropicKeyEnv)) {
    if (det) {
      return success({
        answerText: det.text,
        speechText: det.speech,
        intent,
        confidence,
        language: 'en',
        dataSourcesUsed: det.sources,
        warnings: det.warnings ?? [],
        llmUsed: false,
        llm: { active: false, provider: null, used: false, model: null },
      })
    }
    const noLLMMsg = 'I can answer operational dashboard commands, but conversational AI is not connected yet. Configure LLM_PROVIDER and API key in Netlify environment variables.'
    return success({
      answerText: noLLMMsg,
      speechText: 'Conversational AI is not connected.',
      intent: intent === 'normal_chat' ? 'normal_chat' : intent,
      confidence,
      language: 'en',
      dataSourcesUsed: [],
      warnings: ['LLM not configured'],
      llmUsed: false,
      llmProvider: null,
      llm: { active: false, provider: null, used: false, model: null },
    })
  }

  // Await service-role per-ad data (fetched in parallel with intent detection above)
  const serverAds = await serverAdsPromise
  const adRows30 = await adRows30Promise
  const webinarBuyers = await webinarBuyersPromise
  const creativeAnalyticsText = `${renderCreativeAnalytics(adRows30, today)}\n\n${renderWebinarBuyers(webinarBuyers)}`

  // Build LLM user message with context. When we have a deterministic answer for
  // this intent, hand the LLM those EXACT numbers as a verified anchor and ask it
  // to rephrase them freshly — varied persona wording, identical figures.
  const contextText = buildContextText(ctx, serverAds, creativeAnalyticsText)
  const grounding = det
    ? `\n\n=== VERIFIED ANSWER (these numbers are correct — rephrase FRESHLY in your persona; vary the wording every time, keep EVERY figure exactly, and introduce no number that is not here or in the context above) ===\n${det.text}`
    : ''
  const userMessage = `${contextText}${grounding}\n\n=== USER QUESTION ===\n${message}\n\n(Detected intent: ${intent}, confidence: ${confidence.toFixed(2)}, matched: ${matchedTerms.join(', ') || 'none'})`
  // A touch of temperature for variety, kept low so numbers stay disciplined.
  const opts = { temperature: 0.55, max_tokens: 700 }

  try {
    let rawLLM
    let usedProvider
    let usedModel

    if (llmProviderEnv === 'openai' && openaiKeyEnv) {
      rawLLM = await callOpenAI(userMessage, openaiKeyEnv, opts)
      usedProvider = 'openai'
      usedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    } else if (anthropicKeyEnv) {
      rawLLM = await callAnthropic(userMessage, anthropicKeyEnv, opts)
      usedProvider = 'anthropic'
      usedModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
    } else if (openaiKeyEnv) {
      rawLLM = await callOpenAI(userMessage, openaiKeyEnv, opts)
      usedProvider = 'openai'
      usedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    } else {
      throw new Error('No API key available')
    }

    const { answerText, speechText } = parseLLMResponse(rawLLM)

    return success({
      answerText,
      speechText,
      intent,
      confidence,
      language: 'en',
      dataSourcesUsed: ['llm', ...(det ? det.sources : []), ...(contextText.includes('Today KPIs') ? ['todayKPIs'] : [])],
      warnings: det?.warnings ?? [],
      llmUsed: true,
      llmProvider: usedProvider,
      llm: { active: true, provider: usedProvider, used: true, model: usedModel },
    })
  } catch (err) {
    // LLM failed — if we have a deterministic answer, serve it so the user still
    // gets the correct numbers (just in fixed wording) instead of an error.
    if (det) {
      return success({
        answerText: det.text,
        speechText: det.speech,
        intent,
        confidence,
        language: 'en',
        dataSourcesUsed: det.sources,
        warnings: [...(det.warnings ?? []), `LLM error (deterministic fallback): ${String(err).slice(0, 80)}`],
        llmUsed: false,
        llm: { active: llmActive, provider: llmProviderEnv ?? null, used: false, model: null },
      })
    }
    const errMsg = `AI error: ${String(err).slice(0, 100)}. Retry or check your API key.`
    return success({
      answerText: errMsg,
      speechText: 'AI connection error.',
      intent,
      confidence,
      language: 'en',
      dataSourcesUsed: [],
      warnings: [`LLM error: ${String(err).slice(0, 100)}`],
      llmUsed: false,
      llm: { active: llmActive, provider: llmProviderEnv ?? null, used: false, model: null },
    })
  }
}
