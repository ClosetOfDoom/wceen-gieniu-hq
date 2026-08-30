// KROK 0 diagnostics: ask the real question against the deployed backend with a
// full, live-populated context and print the RAW answer string.
const SITE = 'https://elegant-kelpie-6fdfc8.netlify.app'
const SB = 'https://phwhsteaqwrijoivqnif.supabase.co'
const KEY = 'sb_publishable_qAWyU9LkiRwNHPGfYA6dqg_WTLSQNcc'

const sb = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  return r.ok ? r.json() : []
}
const fn = async (p) => {
  try { const r = await fetch(`${SITE}/.netlify/functions/${p}`); return r.ok ? await r.json() : null } catch { return null }
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
const trend = await sb('v_daily_wix_meta_performance?select=*&order=date.desc&limit=7')
const perf = trend.find((r) => r.date === today) ?? null
const [campaigns, orders, profit] = await Promise.all([fn('campaign-data'), fn('orders-data'), fn('profit-data')])
const ads = (campaigns?.rows ?? campaigns?.ads ?? []).filter((a) => (a.date ?? '') === today)
const sum = (f) => ads.reduce((s, a) => s + (Number(f(a)) || 0), 0)

const context = {
  todayKPIs: perf ? {
    wix_orders: perf.wix_orders, wix_revenue: perf.wix_revenue, meta_spend: perf.meta_spend,
    real_cpa: perf.real_cpa, real_roas: perf.real_roas, date: perf.date,
  } : null,
  profitData: profit?.ok ? {
    ok: true, marginBeforeAds: profit.marginBeforeAds, adSpend: profit.adSpend,
    estimatedProfitAfterAds: profit.estimatedProfitAfterAds,
    estimatedProfitPerOrder: profit.estimatedProfitPerOrder,
    unknownRevenue: profit.unknownRevenue, ordersCount: profit.ordersCount,
  } : null,
  dataHealth: { metaFresh: true, wixFresh: true, latestMetaDate: today, latestWixDate: today, today },
  jsuSummary: null,
  recentTrend: trend.map((r) => ({
    date: r.date, meta_spend: r.meta_spend, wix_orders: r.wix_orders, wix_revenue: r.wix_revenue,
    real_cpa: r.real_cpa, real_roas: r.real_roas,
  })),
  topCampaigns: ads.slice(0, 10).map((a) => ({
    name: a.campaign_name ?? a.campaign_id ?? '?', spend: a.spend, clicks: a.clicks ?? 0,
    link_clicks: a.link_clicks ?? 0, impressions: a.impressions ?? 0,
    purchases: a.meta_purchases ?? a.purchases ?? 0,
  })),
  metaEfficiency: {
    clicks: sum((a) => a.clicks), link_clicks: sum((a) => a.link_clicks),
    impressions: sum((a) => a.impressions), spend: sum((a) => a.spend),
    ctr: null, cpc: null, cpm: null,
  },
  todayByProduct: orders?.today_classified ?? null,
  currentRoute: 'command-center',
}

for (const q of process.argv.slice(2)) {
  const r = await fetch(`${SITE}/.netlify/functions/gieniu-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: q, context }),
  })
  const j = await r.json()
  console.log('─────────────────────────────────────────────────────────────')
  console.log('QUESTION: ' + q)
  console.log('PATH    : ' + (j.llmUsed ? 'MODEL (llm)' : 'DETERMINISTIC builder (no llm)') + ' | intent=' + j.intent)
  console.log('RAW answerText:')
  console.log(JSON.stringify(j.answerText))
  console.log('RAW speechText:')
  console.log(JSON.stringify(j.speechText))
}
