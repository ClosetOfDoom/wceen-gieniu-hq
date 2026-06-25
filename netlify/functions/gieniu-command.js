// GIENIU Command Gateway — bilingual intent routing + LLM fallback.
//
// POST /.netlify/functions/gieniu-command
// Body: { message, context, language }
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
      'ile na czysto', 'zysk dzisiaj', 'zysk dzis', 'jaki zysk', 'ile zysku',
      'profit today', 'how much profit', 'net profit today', 'earned today',
      'profit after ads', 'margin today', 'how much did we earn',
      'zysk po reklamie', 'ile zarobil', 'czy sie oplaca', 'oplaca sie',
      'marza dzis', 'marza dzisiaj', 'na czysto', 'estimated profit',
    ],
  },
  {
    intent: 'revenue_today',
    phrases: [
      'jak idzie dzisiaj', 'jak idzie', 'ile sprzedalismy', 'ile dzisiaj sprzedalismy',
      'revenue today', 'how are we doing today', 'how are we doing',
      'what are sales', 'sales today', 'how much did we make',
      'today revenue', 'co dzisiaj', 'wyniki dzisiaj', 'ile dzisiaj',
      'how much today', 'total revenue', 'przychod dzisiaj',
    ],
  },
  {
    intent: 'orders_freshness',
    phrases: [
      'czy zamowienia sie aktualizuja', 'zamowienia aktualizuja', 'czy zamowienia sa aktualne',
      'are orders updating', 'orders updating', 'orders fresh', 'orders stale',
      'wix aktualizuje', 'czy wix dziala', 'wix updating', 'are orders fresh',
      'orders sync', 'zamowienia dzis', 'are wix orders updating',
    ],
  },
  {
    intent: 'meta_freshness',
    phrases: [
      'czy meta sie aktualizuje', 'meta aktualizuje', 'czy meta dziala',
      'is meta updating', 'meta fresh', 'meta stale', 'meta data updating',
      'facebook updating', 'ads updating', 'reklamy sie aktualizuja',
    ],
  },
  {
    intent: 'campaigns_today',
    phrases: [
      'co z kampaniami', 'kampanie dzis', 'co sie dzieje z reklamami',
      'why are campaigns not showing', 'campaigns not showing', 'campaign performance',
      'which campaigns', 'best campaign', 'top campaign', 'show me campaigns',
      'campaign data', 'pokaz kampanie', 'what campaigns',
    ],
  },
  {
    intent: 'jsu_funnel',
    phrases: [
      'czemu kurs jak sie uczyc sie nie sprzedaje', 'kurs jak sie uczyc',
      'czemu kurs sie nie sprzedaje', 'why did jsu not sell', 'why jsu not selling',
      'jsu funnel', 'webinar jsu', 'jsu webinar', 'funnel jsu',
      'who attended and bought', 'kto byl i kupil', 'kto kupil',
      'attendance rate', 'webinar funnel', 'co z webinarem', 'jsu',
    ],
  },
  {
    intent: 'data_health',
    phrases: [
      'data health', 'data status', 'co z danymi', 'czy dane sa aktualne',
      'are data fresh', 'is data fresh', 'data freshness', 'dane aktualne',
      'diagnoza', 'co jest nie tak z danymi', 'system status',
    ],
  },
  {
    intent: 'red_flags',
    phrases: [
      'what needs attention', 'what should i fix first', 'co naprawic najpierw',
      'co wymaga uwagi', 'what is wrong', 'co jest nie tak', 'issues today',
      'red flags', 'what to fix', 'what is broken', 'biggest problem',
      'co poprawic', 'co wymaga natychmiastowej uwagi',
    ],
  },
  {
    intent: 'retargeting',
    phrases: [
      'co przepala kase', 'co przepala budzet', 'co ubic', 'what to kill',
      'what should i kill', 'stop campaigns', 'kill campaigns',
      'wasting money', 'what is wasting money', 'co skalowac', 'what to scale',
      'what should i scale', 'retargeting', 'retarget',
    ],
  },
  {
    intent: 'creative_recommendations',
    phrases: [
      'creative recommendations', 'best ad creative', 'top performing ad',
      'which ad is best', 'creative performance', 'najlepsza reklama',
    ],
  },
  {
    intent: 'email_rhythm',
    phrases: [
      'czy mailing siadl', 'mailing siadl', 'email performance', 'email rhythm',
      'czy mailing dziala', 'mailing performance', 'deliverability',
    ],
  },
  {
    intent: 'today_vs_yesterday',
    phrases: [
      'vs yesterday', 'vs wczoraj', 'today vs', 'dzisiaj vs', 'compare today', 'today against yesterday',
      'porownaj dzisiaj', 'porownaj dzis', 'compare days', 'today vs yesterday',
    ],
  },
  {
    intent: 'yesterday',
    phrases: [
      'how was yesterday', 'yesterday', 'wczoraj', 'jak bylo wczoraj', 'jak wczoraj',
      'wyniki wczoraj', 'co bylo wczoraj', 'jakie revenue wczoraj', 'what happened yesterday',
    ],
  },
  {
    intent: 'week_summary',
    phrases: [
      'week so far', 'this week', 'ten tydzien', 'jak idzie tydzien', 'week to date', 'wtd',
      'weekly trend', 'tydzien podsumowanie', 'podsumowanie tygodnia',
    ],
  },
  {
    intent: 'last_7_days',
    phrases: [
      'last 7', 'last seven', 'past 7', 'past seven', 'ostatnie 7', 'ostatnich 7',
      '7 days', 'seven days', 'last 7 days',
    ],
  },
  {
    intent: 'sales_by_product',
    phrases: [
      'co sprzedalismy', 'co sprzedalismy dzis', 'co dzis sprzedalismy', 'jakie produkty dzis',
      'ile jsu', 'ile kursow', 'ile pakietow', 'ile pamieciowych', 'ile jezykowych',
      'ile jezykozakow', 'ile pp', 'ile pl', 'ile jzk',
      'sales by product', 'what did we sell', 'what did we sell today', 'products sold today',
      'how many courses today', 'how many jsu', 'how many memory packs', 'jsu today',
      'sprzedajemy kursy', 'czy sprzedajemy jsu', 'jakie produkty', 'product breakdown',
      'co sie sprzedalo', 'sales breakdown', 'rozkład sprzedaży', 'sprzedaz per produkt',
    ],
  },
  {
    intent: 'meta_efficiency',
    phrases: [
      'ctr', 'cpc', 'cpm', 'click through rate', 'cost per click', 'cost per mille',
      "what's the ctr", 'what is the ctr', 'whats the ctr',
      "what's the cpc", 'what is the cpc', 'whats the cpc',
      'koszt klikniecia', 'wskaznik klikalnosci', 'efektywnosc reklam',
      'jak klikalny', 'ile kosztuje klikniecie', 'click rate',
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

  const hasPolish = /[ąćęłńóśźż]/i.test(message) ||
    norm.split(/\s+/).some(w => ['ile', 'jak', 'czy', 'co', 'czemu', 'kto', 'nie', 'sie', 'jest', 'czy'].includes(w))

  return {
    intent: bestScore >= 0.4 ? bestIntent : 'normal_chat',
    confidence: Math.min(bestScore, 1.0),
    language: hasPolish ? 'pl' : 'en',
    matchedTerms: bestMatches,
  }
}

// ── Deterministic answer builders ─────────────────────────────────────────────

function fmt(n, digits = 2) {
  return n != null ? n.toFixed(digits) : '—'
}

function buildRevenueAnswer(ctx, lang) {
  const kpi = ctx.todayKPIs
  if (!kpi) {
    const msg = lang === 'pl'
      ? 'Brak danych KPI na dziś. Sprawdź synchronizację Wix.'
      : 'No KPI data for today. Check Wix sync in the Automation tab.'
    return { text: msg, speech: msg, sources: [], warnings: ['todayKPIs unavailable'] }
  }
  const orders = kpi.wix_orders ?? 0
  const revenue = kpi.wix_revenue ?? 0
  const spend = kpi.meta_spend ?? 0
  const roas = kpi.real_roas != null ? `${fmt(kpi.real_roas)}x` : '—'
  const cpa = kpi.real_cpa != null ? `${fmt(kpi.real_cpa)} PLN` : '—'

  if (orders === 0 && revenue === 0) {
    const msg = lang === 'pl'
      ? `Brak zamówień dziś. Wydatki Meta: ${fmt(spend)} PLN. Sprawdź synchronizację Wix.`
      : `No orders recorded today yet. Meta spend: ${fmt(spend)} PLN. Check Wix sync.`
    return { text: msg, speech: msg, sources: ['todayKPIs'], warnings: ['no orders today'] }
  }

  if (lang === 'pl') {
    return {
      text: `${orders} zamówień | ${fmt(revenue)} PLN przychodu\nWydatki Meta: ${fmt(spend)} PLN\nReal ROAS: ${roas} | Real CPA: ${cpa}`,
      speech: `${orders} zamówień, ${fmt(revenue)} złotych przychodu. Wydatki na reklamy: ${fmt(spend)} złotych.`,
      sources: ['todayKPIs'],
      warnings: [],
    }
  }
  return {
    text: `${orders} orders | ${fmt(revenue)} PLN revenue\nMeta spend: ${fmt(spend)} PLN\nReal ROAS: ${roas} | Real CPA: ${cpa}`,
    speech: `${orders} orders, ${fmt(revenue)} PLN revenue today. Meta spend: ${fmt(spend)} PLN.`,
    sources: ['todayKPIs'],
    warnings: [],
  }
}

function buildProfitAnswer(ctx, lang) {
  const p = ctx.profitData
  if (!p?.ok) {
    const msg = lang === 'pl'
      ? 'Dane o zysku są niedostępne. Sprawdź endpoint profit-data w Diagnostics.'
      : 'Profit data is not available right now. Check the profit endpoint in Diagnostics.'
    return { text: msg, speech: msg, sources: [], warnings: ['profitData unavailable'] }
  }
  const profit = p.estimatedProfitAfterAds ?? 0
  const verdictPL = profit > 100 ? 'Rentowny dzień.' : profit >= 0 ? 'Na granicy rentowności.' : 'Przepalamy — wydatki > przychód.'
  const verdictEN = profit > 100 ? 'Profitable day.' : profit >= 0 ? 'Break-even territory.' : 'Spending more than earning.'
  const unknown = (p.unknownRevenue ?? 0) > 0
    ? (lang === 'pl' ? `\n⚠ ${fmt(p.unknownRevenue)} PLN przychodów niezidentyfikowanych — wykluczone z zysku.` : `\n⚠ ${fmt(p.unknownRevenue)} PLN unmapped revenue excluded from profit.`)
    : ''

  if (lang === 'pl') {
    return {
      text: `${verdictPL}\nMarża (znane produkty): ${fmt(p.marginBeforeAds)} PLN\nWydatki Meta: ${fmt(p.adSpend)} PLN\nZysk est.: ${fmt(profit)} PLN\nZysk/zamówienie: ${fmt(p.estimatedProfitPerOrder)} PLN${unknown}`,
      speech: `${verdictPL} Marża: ${fmt(p.marginBeforeAds)} złotych. Reklamy: ${fmt(p.adSpend)} złotych. Zysk: ${fmt(profit)} złotych.`,
      sources: ['profitData'],
      warnings: unknown ? ['unmapped revenue excluded'] : [],
    }
  }
  return {
    text: `${verdictEN}\nContribution margin: ${fmt(p.marginBeforeAds)} PLN\nMeta spend: ${fmt(p.adSpend)} PLN\nEst. profit: ${fmt(profit)} PLN\nProfit/order: ${fmt(p.estimatedProfitPerOrder)} PLN${unknown}`,
    speech: `${verdictEN} Margin: ${fmt(p.marginBeforeAds)} PLN. Spend: ${fmt(p.adSpend)} PLN. Estimated profit: ${fmt(profit)} PLN.`,
    sources: ['profitData'],
    warnings: unknown ? ['unmapped revenue excluded'] : [],
  }
}

function buildOrdersFreshnessAnswer(ctx, lang) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const fresh = dh.wixFresh
  const date = dh.latestWixDate ?? '—'
  const today = dh.today ?? '—'
  if (fresh) {
    const msg = lang === 'pl'
      ? `Zamówienia aktualne. Ostatnia data Wix: ${date} (dziś).`
      : `Orders are up to date. Latest Wix date: ${date} (today).`
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const text = lang === 'pl'
    ? `Zamówienia mogą być nieaktualne. Ostatnia data Wix: ${date}. Oczekiwana: ${today}.\nNext action: Sprawdź automatyzację Make → Wix w zakładce Automation.`
    : `Orders may be stale. Latest Wix date: ${date}. Expected: ${today}.\nNext action: Check Make → Wix sync in the Automation tab.`
  return {
    text,
    speech: lang === 'pl' ? `Zamówienia mogą być nieaktualne. Ostatnia data: ${date}.` : `Orders may be stale. Latest date: ${date}.`,
    sources: ['dataHealth'],
    warnings: [`Wix date ${date} may be stale (expected ${today})`],
  }
}

function buildMetaFreshnessAnswer(ctx, lang) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const fresh = dh.metaFresh
  const date = dh.latestMetaDate ?? '—'
  if (fresh) {
    const msg = lang === 'pl'
      ? `Meta się aktualizuje. Ostatnia data: ${date} (dziś).`
      : `Meta is updating. Latest date: ${date} (today).`
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const text = lang === 'pl'
    ? `Dane Meta mogą być nieaktualne. Ostatnia data: ${date}. Meta zazwyczaj opóźnia się 1-3 godz. Jeśli dłużej — sprawdź integrację Meta Ads.`
    : `Meta data may be stale. Latest date: ${date}. Meta usually lags 1-3 hours. If longer — check Meta Ads integration.`
  return {
    text,
    speech: lang === 'pl' ? `Dane Meta nieaktualne. Ostatnia data: ${date}.` : `Meta data stale. Latest date: ${date}.`,
    sources: ['dataHealth'],
    warnings: [`Meta date ${date} may be stale`],
  }
}

function buildDataHealthAnswer(ctx, lang) {
  const dh = ctx.dataHealth
  if (!dh) return null
  const issues = []
  if (!dh.metaFresh) issues.push(lang === 'pl' ? `Dane Meta nieaktualne (${dh.latestMetaDate})` : `Meta data stale (${dh.latestMetaDate})`)
  if (!dh.wixFresh) issues.push(lang === 'pl' ? `Zamówienia Wix nieaktualne (${dh.latestWixDate})` : `Wix orders stale (${dh.latestWixDate})`)
  if (issues.length === 0) {
    const msg = lang === 'pl' ? 'Wszystkie dane aktualne. Meta i Wix zsynchronizowane.' : 'All data sources fresh. Meta and Wix are up to date.'
    return { text: msg, speech: msg, sources: ['dataHealth'], warnings: [] }
  }
  const issueList = issues.map(i => `⚠ ${i}`).join('\n')
  return {
    text: (lang === 'pl' ? 'Problemy z danymi:\n' : 'Data health issues:\n') + issueList + '\n' + (lang === 'pl' ? 'Sprawdź zakładkę Automation.' : 'Check the Automation tab.'),
    speech: lang === 'pl' ? `${issues.length} problem${issues.length > 1 ? 'y' : ''} z danymi. ${issues.join('. ')}.` : `${issues.length} data issue${issues.length > 1 ? 's' : ''}: ${issues.join('. ')}.`,
    sources: ['dataHealth'],
    warnings: issues,
  }
}

function buildCampaignsAnswer(ctx, lang) {
  const campaigns = ctx.topCampaigns ?? []
  if (campaigns.length === 0) {
    const msg = lang === 'pl'
      ? 'Brak danych kampanii. Sprawdź synchronizację Meta Ads.'
      : 'No campaign data loaded. Check Meta Ads sync in the Automation tab.'
    return { text: msg, speech: msg, sources: [], warnings: ['no campaign data'] }
  }
  const sorted = [...campaigns].sort((a, b) => b.spend - a.spend)
  const lines = sorted.slice(0, 5).map(c => {
    const imp   = c.impressions ?? 0
    const cl    = c.clicks ?? 0
    const lcl   = c.link_clicks ?? cl
    const ctr   = imp > 0 ? (lcl / imp * 100).toFixed(2) + '%' : '—'
    const cpc   = cl  > 0 ? fmt(c.spend / cl) + ' PLN' : '—'
    return `${c.name}: spend ${fmt(c.spend)} | clicks ${cl} | CTR ${ctr} | CPC ${cpc} | purchases ${c.purchases}`
  })
  const topName = sorted[0]?.name ?? '—'
  return {
    text: (lang === 'pl' ? 'Top kampanie wg wydatków:\n' : 'Top campaigns by spend:\n') + lines.join('\n'),
    speech: lang === 'pl' ? `Załadowano ${campaigns.length} kampanii. Największa: ${topName}.` : `${campaigns.length} campaigns loaded. Top spender: ${topName}.`,
    sources: ['topCampaigns'],
    warnings: [],
  }
}

function buildSalesByProductAnswer(ctx, lang) {
  const tbp = ctx.todayByProduct
  if (!tbp) {
    const msg = lang === 'pl'
      ? 'Obawiam się, że rozkład sprzedaży per produkt nie jest dziś dostępny, sir. Dane zamówień nie zostały załadowane.'
      : "I'm afraid today's product breakdown is unavailable, sir. Orders data was not loaded."
    return { text: msg, speech: msg, sources: [], warnings: ['no todayByProduct'] }
  }

  const jsu    = tbp.jsu_course   ?? { count: 0, revenue: 0 }
  const jzk    = tbp.jzk_language ?? { count: 0, revenue: 0 }
  const mem    = tbp.memory_pack   ?? { count: 0, revenue: 0 }
  const unk    = tbp.unknown       ?? { count: 0 }
  const total  = jsu.count + jzk.count + mem.count + unk.count

  if (total === 0) {
    const msg = lang === 'pl'
      ? 'Nie odnotowano dziś żadnej sprzedaży, sir. Czyste konto — dzień jeszcze trwa.'
      : 'No sales recorded today, sir. The ledger remains pristine — the day is not yet done.'
    return { text: msg, speech: msg, sources: ['todayByProduct'], warnings: [] }
  }

  const lines = []
  const hasSales = (p) => p.count > 0

  if (lang === 'pl') {
    lines.push('— SPRZEDAŻ DZIŚ PER PRODUKT —', '')
    if (hasSales(mem)) lines.push(`Pakiet Pamięciowy:    ${mem.count} szt. × 119 zł = ${fmt(mem.revenue)} zł`)
    if (hasSales(jsu)) lines.push(`Kurs Jak się uczyć:   ${jsu.count} szt. × 549 zł = ${fmt(jsu.revenue)} zł`)
    if (hasSales(jzk)) lines.push(`Językozak / Językowy: ${jzk.count} szt. = ${fmt(jzk.revenue)} zł`)
    if (hasSales(unk)) lines.push(`Niezmapowane:         ${unk.count} szt.`)
    lines.push('')
    lines.push(`Łącznie: ${total} sprzedaży`)
  } else {
    lines.push('— TODAY\'S SALES BY PRODUCT —', '')
    if (hasSales(mem)) lines.push(`Pakiet Pamięciowy:    ${mem.count} × 119 PLN = ${fmt(mem.revenue)} PLN`)
    if (hasSales(jsu)) lines.push(`Kurs Jak się uczyć:   ${jsu.count} × 549 PLN = ${fmt(jsu.revenue)} PLN`)
    if (hasSales(jzk)) lines.push(`Językozak / Language: ${jzk.count} units = ${fmt(jzk.revenue)} PLN`)
    if (hasSales(unk)) lines.push(`Unmapped:             ${unk.count} units`)
    lines.push('')
    lines.push(`Total: ${total} sales`)
  }

  // Verdict / recommendation
  const hasJsu = jsu.count > 0
  const hasMem = mem.count > 0
  let verdict = ''
  if (hasJsu && hasMem) {
    verdict = lang === 'pl'
      ? `Ośmielę się zasugerować, sir: ${jsu.count} kurs JSU to dobry znak — rozważ sekwencję email upsell do ${mem.count} nabywców PP, którzy kursu nie kupili.`
      : `I would venture to suggest, sir: ${jsu.count} JSU course${jsu.count > 1 ? 's' : ''} is an encouraging sign — consider dispatching the upsell sequence to the ${mem.count} PP buyer${mem.count > 1 ? 's' : ''} who have not yet converted.`
  } else if (hasMem && !hasJsu) {
    verdict = lang === 'pl'
      ? `Ośmielę się zasugerować, sir: ${mem.count} Pakiet${mem.count > 1 ? 'ów' : ''} Pamięciowy${mem.count > 1 ? '' : 'y'} — żadnego JSU. Sekwencja upsell do webinaru czwartkowego powinna być aktywna.`
      : `I would venture to suggest, sir: ${mem.count} Memory Pack${mem.count > 1 ? 's' : ''}, zero JSU courses. The upsell sequence toward Thursday's webinar should be live and running.`
  } else if (hasJsu && !hasMem) {
    verdict = lang === 'pl'
      ? `Ośmielę się zasugerować, sir: same kursy JSU bez sprzedaży PP — sprawdź czy zimna kampania działa i dowozi nowych nabywców do lejka.`
      : `I would venture to suggest, sir: JSU sales without PP — verify the cold traffic campaign is active and feeding fresh buyers into the funnel.`
  }
  if (verdict) lines.push('', verdict)

  const speechParts = []
  if (hasSales(mem)) speechParts.push(lang === 'pl' ? `${mem.count} Pakiet${mem.count > 1 ? 'y' : ''} Pamięciow${mem.count > 1 ? 'e' : 'y'}` : `${mem.count} Memory Pack${mem.count > 1 ? 's' : ''}`)
  if (hasSales(jsu)) speechParts.push(lang === 'pl' ? `${jsu.count} kurs${jsu.count > 1 ? 'y' : ''} JSU` : `${jsu.count} JSU course${jsu.count > 1 ? 's' : ''}`)
  if (hasSales(jzk)) speechParts.push(lang === 'pl' ? `${jzk.count} Językozak` : `${jzk.count} Językozak`)
  const speech = lang === 'pl'
    ? `Dziś sprzedaliśmy, sir: ${speechParts.join(', ')}. Łącznie ${total}.`
    : `Today's sales, sir: ${speechParts.join(', ')}. ${total} total.`

  return { text: lines.join('\n'), speech, sources: ['todayByProduct'], warnings: [] }
}

function buildEfficiencyAnswer(ctx, lang) {
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
      const msg = lang === 'pl'
        ? 'Brak danych kampanii — CTR/CPC/CPM niedostępne.'
        : 'No campaign data — CTR/CPC/CPM unavailable. Check Meta Ads sync.'
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
    const msg = lang === 'pl'
      ? 'Brak danych o wyświetleniach i kliknięciach — CTR/CPC/CPM niedostępne. Sprawdź synchronizację Meta Ads.'
      : 'No impressions or clicks data — CTR/CPC/CPM unavailable. Check Meta Ads sync in Automation.'
    return { text: msg, speech: msg, sources: [], warnings: ['no impressions/clicks'] }
  }

  const ctrStr = ctr  != null ? ctr.toFixed(2)  + '%'     : '—'
  const cpcStr = cpc  != null ? fmt(cpc) + ' PLN'          : '—'
  const cpmStr = cpm  != null ? fmt(cpm) + ' PLN'          : '—'

  const verdict = ctr != null
    ? (ctr >= 2
        ? (lang === 'pl' ? `CTR ${ctrStr} — dobry wynik (benchmark 1-2%).` : `CTR at ${ctrStr} — solid (benchmark 1-2%).`)
        : ctr >= 1
          ? (lang === 'pl' ? `CTR ${ctrStr} — przeciętny. Warto przetestować nowe kreacje.` : `CTR at ${ctrStr} — average. Test new creatives.`)
          : (lang === 'pl' ? `CTR ${ctrStr} — poniżej benchmarku. Kreacje wymagają uwagi.` : `CTR at ${ctrStr} — below benchmark. Creatives need review.`))
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

  if (lang === 'pl') {
    const lines = [
      '— EFEKTYWNOŚĆ META ADS (DZIŚ) —', '',
      `CTR (link clicks / wyświetlenia): ${ctrStr}`,
      `CPC (koszt kliknięcia):           ${cpcStr}`,
      `CPM (koszt 1000 wyświetleń):      ${cpmStr}`,
      '',
      `Łącznie: ${clicks} kliknięć | ${impressions} wyświetleń | ${fmt(spend)} PLN wydatków`,
    ]
    if (perCampaign.length > 0) {
      lines.push('', 'Per kampania:')
      lines.push(...perCampaign)
    }
    if (verdict) lines.push('', verdict)
    const speech = `CTR: ${ctrStr}. CPC: ${cpcStr}. CPM: ${cpmStr}. ${verdict}`
    return { text: lines.join('\n'), speech, sources: ['metaEfficiency', 'topCampaigns'], warnings: [] }
  }

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

function buildJsuFunnelAnswer(ctx, lang) {
  const jsu = ctx.jsuSummary
  if (!jsu || jsu.bottleneck === 'NO_DATA' || jsu.bottleneck === 'NO_SOURCES') {
    const msg = lang === 'pl'
      ? 'Brak danych webinarowego lejka JSU. Sprawdź synchronizację Make → ClickMeeting w Automation.'
      : 'JSU webinar funnel data is not available. Check Make → ClickMeeting sync in Automation.'
    return { text: msg, speech: msg, sources: [], warnings: ['jsuSummary unavailable'] }
  }
  const bottleneck = jsu.bottleneck ?? 'OK'
  const diagnosis = jsu.diagnosis ?? ''
  const att = jsu.rates?.attendance_rate != null ? `${(jsu.rates.attendance_rate * 100).toFixed(1)}%` : '—'
  const pur = jsu.rates?.purchase_rate != null ? `${(jsu.rates.purchase_rate * 100).toFixed(1)}%` : '—'
  const totals = jsu.totals ?? {}

  if (lang === 'pl') {
    return {
      text: `Bottleneck JSU: ${bottleneck}\n${diagnosis}\nFrekwencja: ${att} | Konwersja: ${pur}\nZarejestrowani: ${totals.registered ?? '—'} | Obecni: ${totals.attendees ?? '—'} | Kupujący: ${totals.purchases ?? '—'}`,
      speech: `Bottleneck: ${bottleneck}. Frekwencja: ${att}. Konwersja: ${pur}.`,
      sources: ['jsuSummary'],
      warnings: [],
    }
  }
  return {
    text: `JSU Funnel — Bottleneck: ${bottleneck}\n${diagnosis}\nAttendance: ${att} | Purchase conversion: ${pur}\nRegistered: ${totals.registered ?? '—'} | Attended: ${totals.attendees ?? '—'} | Bought: ${totals.purchases ?? '—'}`,
    speech: `JSU bottleneck: ${bottleneck}. Attendance: ${att}. Conversion: ${pur}.`,
    sources: ['jsuSummary'],
    warnings: [],
  }
}

function buildRedFlagsAnswer(ctx, lang) {
  const flags = []
  const dh = ctx.dataHealth
  const p = ctx.profitData
  const kpi = ctx.todayKPIs

  if (dh && !dh.metaFresh) flags.push(lang === 'pl' ? `Meta nieaktualne (${dh.latestMetaDate})` : `Meta data stale (${dh.latestMetaDate})`)
  if (dh && !dh.wixFresh) flags.push(lang === 'pl' ? `Wix nieaktualne (${dh.latestWixDate})` : `Wix orders stale (${dh.latestWixDate})`)
  if (p?.ok && (p.estimatedProfitAfterAds ?? 0) < 0) flags.push(lang === 'pl' ? `Ujemny zysk: ${fmt(p.estimatedProfitAfterAds)} PLN` : `Negative profit: ${fmt(p.estimatedProfitAfterAds)} PLN`)
  if (kpi?.real_cpa != null && kpi.real_cpa > 60) flags.push(lang === 'pl' ? `CPA bardzo wysoki: ${fmt(kpi.real_cpa)} PLN` : `CPA very high: ${fmt(kpi.real_cpa)} PLN`)
  if (kpi?.real_roas != null && kpi.real_roas < 1.5) flags.push(lang === 'pl' ? `ROAS niski: ${fmt(kpi.real_roas)}x` : `ROAS low: ${fmt(kpi.real_roas)}x`)
  if ((p?.unknownRevenue ?? 0) > 100) flags.push(lang === 'pl' ? `${fmt(p?.unknownRevenue)} PLN niezidentyfikowanych przychodów` : `${fmt(p?.unknownRevenue)} PLN unmapped revenue`)

  if (flags.length === 0) {
    const msg = lang === 'pl' ? 'Brak krytycznych problemów w danych dashboardu.' : 'No critical issues detected in dashboard data.'
    return { text: msg, speech: msg, sources: ['todayKPIs', 'profitData', 'dataHealth'], warnings: [] }
  }

  const list = flags.map((f, i) => `${i + 1}. ${f}`).join('\n')
  return {
    text: (lang === 'pl' ? `Red flags (${flags.length}):\n` : `Red flags (${flags.length}):\n`) + list,
    speech: lang === 'pl' ? `${flags.length} red flag${flags.length > 1 ? 's' : ''}. Pierwszy: ${flags[0]}.` : `${flags.length} red flag${flags.length > 1 ? 's' : ''}. Top: ${flags[0]}.`,
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

function buildYesterdayAnswer(ctx, lang) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = lang === 'pl'
      ? 'Brak danych historycznych — recentTrend nie został załadowany.'
      : 'No historical data available — recentTrend was not loaded.'
    return { text: msg, speech: msg, sources: [], warnings: ['no recentTrend'] }
  }
  const today   = ctx.dataHealth?.today ?? ''
  const yDate   = today ? prevDay(today) : null
  const row     = (yDate ? trend.find(r => r.date === yDate) : null) ?? trend[1] ?? null

  if (!row) {
    const msg = lang === 'pl'
      ? `Brak danych za wczoraj (${yDate ?? '?'}). Dostępne daty: ${trend.map(r => r.date).join(', ')}.`
      : `No data for yesterday (${yDate ?? '?'}). Available dates: ${trend.map(r => r.date).join(', ')}.`
    return { text: msg, speech: msg, sources: ['recentTrend'], warnings: ['no yesterday row'] }
  }

  const orders    = row.wix_orders   ?? 0
  const revenue   = row.wix_revenue  ?? 0
  const spend     = row.meta_spend   ?? 0
  const cpa       = row.real_cpa
  const roas      = row.real_roas
  const purchases = row.meta_purchases ?? 0

  const verdict = spend > 0 && orders === 0
    ? (lang === 'pl' ? 'Reklamy działały, ale bez sprzedaży.' : 'Spend went out, nothing came back.')
    : roas != null && roas >= 3
      ? (lang === 'pl' ? `Dobry dzień — ROAS ${fmt(roas)}x.` : `Good day — ROAS at ${fmt(roas)}x.`)
      : roas != null && roas < 2
        ? (lang === 'pl' ? 'Słabe ROAS — reklamy nie zwróciły kosztów.' : 'Weak ROAS — ads underperformed.')
        : orders > 0
          ? (lang === 'pl' ? 'Solidny dzień operacyjny.' : 'Solid operational day.')
          : (lang === 'pl' ? 'Brak danych sprzedażowych.' : 'No sales data.')

  if (lang === 'pl') {
    const lines = [
      `— WCZORAJ ${row.date} —`, '',
      `Zamówienia: ${orders}`,
      `Przychód: ${fmt(revenue)} PLN`,
      `Wydatki Meta: ${fmt(spend)} PLN`,
    ]
    if (cpa  != null) lines.push(`Real CPA: ${fmt(cpa)} PLN`)
    if (roas != null) lines.push(`Real ROAS: ${fmt(roas)}x`)
    if (purchases > 0) lines.push(`Meta zakupy: ${purchases}`)
    lines.push('', verdict)
    const speech = `Wczoraj, ${row.date}: ${orders} zamówień, ${fmt(revenue, 0)} złotych przychodu, ${fmt(spend, 0)} złotych wydatków.${roas != null ? ` ROAS ${fmt(roas)}x.` : ''}`
    return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
  }

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

function buildTodayVsYesterdayAnswer(ctx, lang) {
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
    const msg = lang === 'pl'
      ? `Brak danych do porównania. Dostępne daty: ${trend.map(r => r.date).join(', ') || 'brak'}.`
      : `Cannot compare — missing data. Available dates: ${trend.map(r => r.date).join(', ') || 'none'}.`
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
    ? (lang === 'pl' ? 'Dzisiaj lepiej niż wczoraj. Dobry trend, Lifidi.' : 'Today is ahead of yesterday. Good trend, Lifidi.')
    : revDelta < 0
      ? (lang === 'pl' ? 'Dziś poniżej wczoraj. Dzień jeszcze trwa — sprawdź kampanie.' : 'Today is behind yesterday. Day not over — check campaigns.')
      : (lang === 'pl' ? 'Identycznie jak wczoraj.' : 'Identical to yesterday.')

  if (lang === 'pl') {
    const lines = [
      `— DZIŚ vs WCZORAJ —`, '',
      `                Wczoraj (${yRow.date})     Dziś (${todayRow.date ?? today})`,
      `Zamówienia:     ${yOrders}                  ${todayOrders}   (${sign(orderDelta)}${orderDelta})`,
      `Przychód:       ${fmt(yRevenue)} PLN         ${fmt(todayRevenue)} PLN   (${sign(revDelta)}${fmt(revDelta)}${revPct != null ? `, ${sign(revPct)}${revPct.toFixed(0)}%` : ''})`,
      `Wydatki Meta:   ${fmt(ySpend)} PLN           ${fmt(todaySpend)} PLN   (${sign(spendDelta)}${fmt(spendDelta)})`,
    ]
    if (todayRow.real_roas != null && yRow.real_roas != null) {
      const rd = (todayRow.real_roas ?? 0) - (yRow.real_roas ?? 0)
      lines.push(`ROAS:           ${fmt(yRow.real_roas)}x                ${fmt(todayRow.real_roas)}x   (${sign(rd)}${fmt(rd)})`)
    }
    lines.push('', verdict)
    const speech = `Dziś vs wczoraj. Przychód: ${fmt(todayRevenue, 0)} vs ${fmt(yRevenue, 0)} złotych (${sign(revDelta)}${fmt(revDelta, 0)} PLN). Zamówienia: ${todayOrders} vs ${yOrders}.`
    return { text: lines.join('\n'), speech, sources: ['todayKPIs', 'recentTrend'], warnings: [] }
  }

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

function buildWeekSummaryAnswer(ctx, lang) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = lang === 'pl' ? 'Brak danych historycznych.' : 'No historical data available.'
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
    const msg = lang === 'pl' ? 'Brak danych z tego tygodnia jeszcze.' : 'No data for this week yet.'
    return { text: msg, speech: msg, sources: ['recentTrend'], warnings: ['no this-week rows'] }
  }

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const wtdCPA       = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const wtdROAS      = totalSpend > 0 ? totalRevenue / totalSpend : null

  if (lang === 'pl') {
    const lines = [
      `— TEN TYDZIEŃ (${rows.length} dni, od ${weekStartStr}) —`, '',
      `Zamówienia łącznie: ${totalOrders}`,
      `Przychód łącznie: ${fmt(totalRevenue)} PLN`,
      `Wydatki Meta łącznie: ${fmt(totalSpend)} PLN`,
    ]
    if (wtdCPA)  lines.push(`WTD CPA: ${fmt(wtdCPA)} PLN`)
    if (wtdROAS) lines.push(`WTD ROAS: ${fmt(wtdROAS)}x`)
    lines.push('', `${rows.length} ${rows.length === 1 ? 'dzień' : 'dni'} z danymi: ${rows.map(r => r.date).join(', ')}.`)
    const speech = `Ten tydzień: ${totalOrders} zamówień, ${fmt(totalRevenue, 0)} złotych przychodu, ${fmt(totalSpend, 0)} złotych wydatków.${wtdROAS != null ? ` ROAS ${fmt(wtdROAS)}x.` : ''}`
    return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
  }

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

function buildLast7Answer(ctx, lang) {
  const trend = ctx.recentTrend ?? []
  if (trend.length === 0) {
    const msg = lang === 'pl' ? 'Brak danych historycznych.' : 'No historical data available.'
    return { text: msg, speech: msg, sources: [], warnings: ['no recentTrend'] }
  }
  const rows = [...trend].sort((a, b) => a.date < b.date ? -1 : 1)

  const totalOrders  = rows.reduce((s, r) => s + (r.wix_orders  ?? 0), 0)
  const totalRevenue = rows.reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
  const totalSpend   = rows.reduce((s, r) => s + (r.meta_spend  ?? 0), 0)
  const avgCPA       = totalSpend > 0 && totalOrders > 0 ? totalSpend / totalOrders : null
  const avgROAS      = totalSpend > 0 ? totalRevenue / totalSpend : null

  const label = lang === 'pl' ? 'OSTATNIE 7 DNI' : 'LAST 7 DAYS'
  const lines = [
    `— ${label} (${rows[0]?.date} → ${rows[rows.length - 1]?.date}) —`, '',
    lang === 'pl' ? `Łączne zamówienia: ${totalOrders}` : `Total orders: ${totalOrders}`,
    lang === 'pl' ? `Łączny przychód: ${fmt(totalRevenue)} PLN` : `Total revenue: ${fmt(totalRevenue)} PLN`,
    lang === 'pl' ? `Łączne wydatki Meta: ${fmt(totalSpend)} PLN` : `Total Meta spend: ${fmt(totalSpend)} PLN`,
  ]
  if (avgCPA)  lines.push(lang === 'pl' ? `Średnie CPA: ${fmt(avgCPA)} PLN` : `Average CPA: ${fmt(avgCPA)} PLN`)
  if (avgROAS) lines.push(lang === 'pl' ? `Średnie ROAS: ${fmt(avgROAS)}x` : `Average ROAS: ${fmt(avgROAS)}x`)
  lines.push('')
  rows.forEach(r => {
    const cpaStr  = r.real_cpa  != null ? `  CPA: ${fmt(r.real_cpa)}`   : ''
    const roasStr = r.real_roas != null ? `  ROAS: ${fmt(r.real_roas)}x` : ''
    lines.push(`  ${r.date}: ${r.wix_orders ?? 0} orders | ${fmt(r.wix_revenue ?? 0)} PLN | spend ${fmt(r.meta_spend ?? 0)}${cpaStr}${roasStr}`)
  })
  const speech = lang === 'pl'
    ? `Ostatnie 7 dni: ${totalOrders} zamówień łącznie, ${fmt(totalRevenue, 0)} złotych przychodu, ${fmt(totalSpend, 0)} złotych wydatków.${avgROAS != null ? ` Średnie ROAS ${fmt(avgROAS)}x.` : ''}`
    : `Last 7 days: ${totalOrders} total orders, ${fmt(totalRevenue, 0)} PLN revenue, ${fmt(totalSpend, 0)} PLN spend.${avgROAS != null ? ` Average ROAS ${fmt(avgROAS)}x.` : ''}`
  return { text: lines.join('\n'), speech, sources: ['recentTrend'], warnings: [] }
}

function buildDeterministicAnswer(intent, context, lang) {
  switch (intent) {
    case 'revenue_today':        return buildRevenueAnswer(context, lang)
    case 'profit_today':         return buildProfitAnswer(context, lang)
    case 'orders_freshness':     return buildOrdersFreshnessAnswer(context, lang)
    case 'meta_freshness':       return buildMetaFreshnessAnswer(context, lang)
    case 'data_health':          return buildDataHealthAnswer(context, lang)
    case 'campaigns_today':      return buildCampaignsAnswer(context, lang)
    case 'jsu_funnel':           return buildJsuFunnelAnswer(context, lang)
    case 'red_flags':            return buildRedFlagsAnswer(context, lang)
    case 'yesterday':            return buildYesterdayAnswer(context, lang)
    case 'today_vs_yesterday':   return buildTodayVsYesterdayAnswer(context, lang)
    case 'week_summary':         return buildWeekSummaryAnswer(context, lang)
    case 'last_7_days':          return buildLast7Answer(context, lang)
    case 'sales_by_product':     return buildSalesByProductAnswer(context, lang)
    case 'meta_efficiency':      return buildEfficiencyAnswer(context, lang)
    default:                     return null
  }
}

// ── Context serialization for LLM ─────────────────────────────────────────────

function buildContextText(context) {
  const { todayKPIs: kpi, profitData: p, dataHealth: dh, jsuSummary: jsu, topCampaigns: campaigns } = context
  const lines = ['=== GIENIU DASHBOARD CONTEXT ===']
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

  if (campaigns && campaigns.length > 0) {
    lines.push('')
    lines.push('--- Top Campaigns (by spend, with efficiency metrics) ---')
    ;[...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5).forEach(c => {
      const imp  = c.impressions ?? 0
      const cl   = c.clicks ?? 0
      const lcl  = c.link_clicks ?? cl
      const ctr  = imp > 0 ? (lcl / imp * 100).toFixed(2) + '%' : 'N/A'
      const cpc  = cl  > 0 ? fmt(c.spend / cl) + ' PLN' : 'N/A'
      const cpm  = imp > 0 ? fmt(c.spend / imp * 1000) + ' PLN' : 'N/A'
      lines.push(`  ${c.name}: spend ${fmt(c.spend)} PLN | clicks ${cl} | impr. ${imp} | CTR ${ctr} | CPC ${cpc} | CPM ${cpm} | purchases ${c.purchases}`)
    })
    // Aggregate efficiency across all loaded campaigns
    const eff = context.metaEfficiency
    if (eff && (eff.impressions > 0 || eff.clicks > 0)) {
      const aCtr = eff.ctr  != null ? eff.ctr.toFixed(2) + '%' : (eff.impressions > 0 ? ((eff.link_clicks ?? eff.clicks) / eff.impressions * 100).toFixed(2) + '%' : 'N/A')
      const aCpc = eff.cpc  != null ? fmt(eff.cpc) + ' PLN' : (eff.clicks > 0 ? fmt(eff.spend / eff.clicks) + ' PLN' : 'N/A')
      const aCpm = eff.cpm  != null ? fmt(eff.cpm) + ' PLN' : (eff.impressions > 0 ? fmt(eff.spend / eff.impressions * 1000) + ' PLN' : 'N/A')
      lines.push(`  [AGGREGATE ALL CAMPAIGNS] CTR ${aCtr} | CPC ${aCpc} | CPM ${aCpm} | total clicks ${eff.clicks} | impr. ${eff.impressions}`)
    }
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
  }

  return lines.join('\n')
}

// ── LLM system prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are GIENIU — the personal operations AI of WCEEN, reporting directly to Lifidi, sir.

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
4. LANGUAGE: Respond in the user's language (Polish or English). Persona works in both — "sir" stays regardless.
5. CONCISION: A majordomo does not ramble. Make each sentence carry weight. Three sharp sentences beat two paragraphs.
6. NEXT MOVE: Every performance answer ends with exactly one concrete recommendation, delivered as a loyal advisor's counsel:
   "I would venture to suggest, sir..." / "Ośmielę się zasugerować, sir..."
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

━━━ RESPONSE FORMAT — EXACT ━━━
ANSWER:
[Your full answer — persona in full effect, numbers only from context, one concrete next move at the end]

SPEECH:
[Shorter spoken version — max 2–3 sentences, no tables, audible in under 12 seconds, persona intact]`

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callOpenAI(userMessage, apiKey) {
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
        max_tokens: 600,
        temperature: 0.3,
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

async function callAnthropic(userMessage, apiKey) {
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
        max_tokens: 600,
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

  let message, context, language
  try {
    ;({ message, context, language } = JSON.parse(event.body ?? '{}'))
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' }
  }

  if (!message || typeof message !== 'string') {
    return { statusCode: 400, body: 'message field is required' }
  }

  const lang = language === 'pl' ? 'pl' : 'en'
  const ctx = context ?? {}

  // LLM env vars — read early so deterministic paths can report llm.active
  const llmProviderEnv = process.env.LLM_PROVIDER
  const openaiKeyEnv   = process.env.OPENAI_API_KEY
  const anthropicKeyEnv = process.env.ANTHROPIC_API_KEY
  const llmActive = !!(llmProviderEnv && (openaiKeyEnv || anthropicKeyEnv))

  // 1 — Detect intent
  const { intent, confidence, matchedTerms } = detectIntent(message)

  // 2 — Deterministic answer for known high-confidence intents
  if (confidence >= 0.4 && intent !== 'normal_chat') {
    const det = buildDeterministicAnswer(intent, ctx, lang)
    if (det) {
      return success({
        answerText: det.text,
        speechText: det.speech,
        intent,
        confidence,
        language: lang,
        dataSourcesUsed: det.sources,
        warnings: det.warnings ?? [],
        llmUsed: false,
        llm: { active: llmActive, provider: llmProviderEnv ?? null, used: false, model: null },
      })
    }
  }

  // 3 — LLM fallback
  if (!llmProviderEnv || (!openaiKeyEnv && !anthropicKeyEnv)) {
    const noLLMMsg = lang === 'pl'
      ? 'Mogę odpowiadać na komendy dashboardowe, ale AI konwersacyjna nie jest jeszcze podłączona. Skonfiguruj LLM_PROVIDER i klucz API w Netlify.'
      : 'I can answer operational dashboard commands, but conversational AI is not connected yet. Configure LLM_PROVIDER and API key in Netlify environment variables.'
    return success({
      answerText: noLLMMsg,
      speechText: lang === 'pl' ? 'Konwersacyjna AI nie jest podłączona.' : 'Conversational AI is not connected.',
      intent: intent === 'normal_chat' ? 'normal_chat' : intent,
      confidence,
      language: lang,
      dataSourcesUsed: [],
      warnings: ['LLM not configured'],
      llmUsed: false,
      llmProvider: null,
      llm: { active: false, provider: null, used: false, model: null },
    })
  }

  // Build LLM user message with context
  const contextText = buildContextText(ctx)
  const userMessage = `${contextText}\n\n=== USER QUESTION ===\n${message}\n\n(Detected intent: ${intent}, confidence: ${confidence.toFixed(2)}, matched: ${matchedTerms.join(', ') || 'none'})`

  try {
    let rawLLM
    let usedProvider
    let usedModel

    if (llmProviderEnv === 'openai' && openaiKeyEnv) {
      rawLLM = await callOpenAI(userMessage, openaiKeyEnv)
      usedProvider = 'openai'
      usedModel = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    } else if (anthropicKeyEnv) {
      rawLLM = await callAnthropic(userMessage, anthropicKeyEnv)
      usedProvider = 'anthropic'
      usedModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
    } else if (openaiKeyEnv) {
      rawLLM = await callOpenAI(userMessage, openaiKeyEnv)
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
      language: lang,
      dataSourcesUsed: ['llm', ...(contextText.includes('Today KPIs') ? ['todayKPIs'] : [])],
      warnings: [],
      llmUsed: true,
      llmProvider: usedProvider,
      llm: { active: true, provider: usedProvider, used: true, model: usedModel },
    })
  } catch (err) {
    const errMsg = lang === 'pl'
      ? `Błąd AI: ${String(err).slice(0, 100)}. Spróbuj ponownie lub sprawdź klucz API.`
      : `AI error: ${String(err).slice(0, 100)}. Retry or check your API key.`
    return success({
      answerText: errMsg,
      speechText: lang === 'pl' ? 'Błąd połączenia z AI.' : 'AI connection error.',
      intent,
      confidence,
      language: lang,
      dataSourcesUsed: [],
      warnings: [`LLM error: ${String(err).slice(0, 100)}`],
      llmUsed: false,
      llm: { active: llmActive, provider: llmProviderEnv ?? null, used: false, model: null },
    })
  }
}
