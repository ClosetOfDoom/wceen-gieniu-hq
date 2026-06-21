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
    intent: 'pipeline',
    phrases: [
      'compare today vs yesterday', 'porownaj dzis do wczoraj', 'how was yesterday',
      'week so far', 'compare days', 'weekly trend', 'tydzien podsumowanie',
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
  const lines = sorted.slice(0, 5).map(c => `${c.name}: ${fmt(c.spend)} PLN spend | ${c.clicks} clicks | ${c.purchases} purchases`)
  const topName = sorted[0]?.name ?? '—'
  return {
    text: (lang === 'pl' ? 'Top kampanie wg wydatków:\n' : 'Top campaigns by spend:\n') + lines.join('\n'),
    speech: lang === 'pl' ? `Załadowano ${campaigns.length} kampanii. Największa: ${topName}.` : `${campaigns.length} campaigns loaded. Top spender: ${topName}.`,
    sources: ['topCampaigns'],
    warnings: [],
  }
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

  if (campaigns && campaigns.length > 0) {
    lines.push('')
    lines.push('--- Top Campaigns (by spend) ---')
    ;[...campaigns].sort((a, b) => b.spend - a.spend).slice(0, 5).forEach(c => {
      lines.push(`${c.name}: ${fmt(c.spend)} PLN spend | ${c.clicks} clicks | ${c.purchases} purchases`)
    })
  }

  return lines.join('\n')
}

// ── LLM system prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are GIENIU, the operational AI assistant for WCEEN (an online learning company).
You speak directly to the user, whose name is Lifidi.
You are direct, strategic, witty, and operational. No corporate fluff.

CRITICAL RULES:
1. NEVER invent or estimate numbers not present in the dashboard context. If data is missing, say so.
2. ALWAYS separate: revenue vs contribution margin vs ad spend vs estimated profit. They are not the same.
3. Answer in the same language the user wrote in (English or Polish), unless they ask otherwise.
4. Be concise and specific — no filler phrases, no generic advice.
5. Always suggest a concrete next action when discussing business performance.
6. Do NOT include raw JSON or data tables in your response.
7. Estimated profit = contribution margin (known products) minus ad spend. It does NOT include unmapped revenue.

For operational/performance questions, structure your answer as:
Verdict: [one-sentence assessment]
Numbers: [key metrics — only what is in the provided context]
Cause/Bottleneck: [if applicable and known from data]
Next action: [concrete, specific recommendation]
[Data caveat if data is stale or missing]

For conversational questions: natural, concise answer. No invented metrics.

IMPORTANT — format your response EXACTLY as:
ANSWER:
[full answer]

SPEECH:
[speech version — shorter, no tables, readable aloud in under 15 seconds]`

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
