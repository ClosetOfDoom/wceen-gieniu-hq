// dailyBrief.js — the 09:00 brief. Every number is computed HERE (code); the model only writes a short introduction that
// describes them, and that introduction goes through the same number guard as the finance Q&A (financeVerify.js):
// a sentence with a number that is not in the brief is removed.
//
// Sections: 1 Sprzedaż (Wix) vs 100 000 zł · 2 Reklamy Meta · 3 Maile webinarowe · 4 Poczta · 5 Plan dnia · 6 Do uwagi.
// Missing data is written as "BRAK DANYCH: <źródło>", never estimated.
//
// deps = {
//   sales(from, to)   → body of profit-data for the Warsaw range (revenue, ordersCount, nonSaleOrdersCount, adSpend, realCpa, realRoas)
//   adRows(from, to)  → meta_ads_daily rows { date, campaign_name, ad_name, ad_id, spend, meta_purchases }
//   mail              → { store, wix, loadTemplates } (webinar mails, as in webinar-mail-health)
//   kv                → the "stanley" KV store (tasks, day ticks, briefs)
//   knowledge         → loadKnowledge() result
// }

import { warsawParts, warsawLocalToUtc, slotForWeekday } from './webinarMail.js'
import { healthSummary } from './webinarMailAdmin.js'
import { isProductionSend, sendStatusView } from './webinarMailStatus.js'
import { splitAdSpend } from './adSpend.js'
import { cpaAlert, roasAlert } from './alertRules.js'
import { STRATEGIC_MONTHLY_GOAL, allMissingQuestions, questionsForDay } from './stanleyKnowledge.js'
import { addDays, dayPlan, listTasks, getDayTicks } from './stanleyTasks.js'
import { buildAllowed, verifyNumbers, scrubModelText } from './financeVerify.js'

export const BRIEF_CONFIG = Object.freeze({
  /** Local hour of the brief; the cron fires at 07 and 08 UTC (09:00 Warsaw in CEST and CET), the other run exits. */
  hour: 9,
  cron: '0 7,8 * * *',
  /** How many briefs the store keeps. */
  keep: 14,
  /** Missing-data questions per day. */
  questionsPerDay: 2,
})

/** Is it 09:00 in Warsaw (the only hour the scheduled run works)? */
export function isBriefHour(now, config = BRIEF_CONFIG) {
  return warsawParts(now).hour === config.hour
}

// ── formatting (plain spaces, so the number guard reads every figure) ──────────

const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
export function zl(n) {
  const v = Math.round(Number(n) * 100) / 100
  const [i, d] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}${group(i)},${d} zł`
}
const pct = (n, digits = 1) => `${(Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace('.', ',')}%`
const x2 = (n) => `${Number(n).toFixed(2).replace('.', ',')}x`
const SLOT_PL = { tuesday: 'wtorek', thursday: 'czwartek' }

async function safe(fn) {
  try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: String(e?.message ?? e).replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').slice(0, 160) } }
}

function daysInMonth(date) {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// ── data ───────────────────────────────────────────────────────────────────────

export async function gatherBriefData({ now, deps }) {
  const today = warsawParts(now).date
  const yesterday = addDays(today, -1)
  const from7 = addDays(today, -7)
  const from3 = addDays(today, -3)
  const monthStart = `${today.slice(0, 8)}01`
  const mtdDays = yesterday.slice(0, 7) === today.slice(0, 7) ? Number(yesterday.slice(8)) : 0

  const [salesY, salesMtd, sales7, ads, mail, tasks, ticks] = await Promise.all([
    safe(() => deps.sales(yesterday, yesterday)),
    mtdDays > 0 ? safe(() => deps.sales(monthStart, yesterday)) : Promise.resolve({ ok: true, value: null }),
    safe(() => deps.sales(from7, yesterday)),
    safe(() => deps.adRows(from7, yesterday)),
    safe(() => mailData(deps.mail, now)),
    safe(() => listTasks(deps.kv)),
    safe(() => getDayTicks(deps.kv, today)),
  ])
  const k = deps.knowledge
  const plan = k ? dayPlan({ date: today, rhythm: k.rhythm, tasks: tasks.ok ? tasks.value : [], ticks: ticks.ok ? ticks.value : [] }) : null
  return {
    today, yesterday, from7, from3, monthStart, mtdDays, daysInMonth: daysInMonth(today),
    salesY, salesMtd, sales7, ads, mail, tasksError: tasks.ok ? null : tasks.error, plan,
    questions: k ? questionsForDay(allMissingQuestions(k), today, BRIEF_CONFIG.questionsPerDay) : [],
    knowledgeMissing: !k,
  }
}

async function mailData({ store, wix, loadTemplates }, now) {
  const health = await healthSummary({ deps: { store, wix, loadTemplates }, build: 'brief', now })
  const log = await store.getLog()
  const sends = log.filter((e) => isProductionSend(e) && e.campaignId).sort((a, b) => String(a.createdAt ?? a.date).localeCompare(String(b.createdAt ?? b.date)))
  const last = sends[sends.length - 1] ?? null
  let stats = null
  let statsError = null
  if (last) {
    try { stats = (await wix.campaignStats([last.campaignId]))[last.campaignId] ?? null } catch (e) { statsError = String(e?.message ?? e).slice(0, 120) }
  }
  return {
    health,
    last: last ? { date: last.date, slot: last.slot, status: sendStatusView(last, now).code, stats, statsError } : null,
    todaySlot: slotForWeekday(warsawParts(now).weekday),
  }
}

// ── rendering ──────────────────────────────────────────────────────────────────

const salesOf = (body) => ({
  revenue: Number(body.revenue ?? 0),
  orders: Number(body.ordersCount ?? 0) - Number(body.nonSaleOrdersCount ?? 0),
  spend: body.adSpend, cpa: body.realCpa, roas: body.realRoas,
})

const SEVERITY_PL = { none: 'OK', amber: 'UWAGA', red: 'ALARM' }

/** { sections: [{ id, title, lines }], text, speech, alerts, gaps } — deterministic, from data only. */
export function renderBrief(d) {
  const gaps = []
  const alerts = []
  const gap = (source, err) => { const g = `BRAK DANYCH: ${source}${err ? ` (${err})` : ''}`; gaps.push(g); return g }
  const sections = []

  // 1 — sales
  const s1 = []
  if (d.salesY.ok) {
    const y = salesOf(d.salesY.value)
    s1.push(`Wczoraj (${d.yesterday}): ${zl(y.revenue)}, zamówień: ${y.orders}.`)
  } else s1.push(`Wczoraj (${d.yesterday}): ${gap('zamówienia Wix (profit-data)', d.salesY.error)}.`)
  if (d.mtdDays === 0) s1.push(`Od początku miesiąca: dziś ${d.today}, pierwszy dzień miesiąca, brak pełnych dni.`)
  else if (d.salesMtd.ok) {
    const m = salesOf(d.salesMtd.value)
    const expected = (STRATEGIC_MONTHLY_GOAL * d.mtdDays) / d.daysInMonth
    s1.push(`Od początku miesiąca (${d.monthStart} – ${d.yesterday}, dni: ${d.mtdDays} z ${d.daysInMonth}): ${zl(m.revenue)} = ${pct((m.revenue / STRATEGIC_MONTHLY_GOAL) * 100)} celu ${zl(STRATEGIC_MONTHLY_GOAL)} (prorata na wczoraj: ${zl(expected)}).`)
  } else s1.push(`Od początku miesiąca: ${gap('zamówienia Wix (profit-data)', d.salesMtd.error)}.`)
  if (d.salesY.ok && d.sales7.ok) {
    const y = salesOf(d.salesY.value)
    const w = salesOf(d.sales7.value)
    const cpaTxt = (v) => (v == null ? 'brak (0 zamówień)' : zl(v))
    const roasTxt = (v) => (v == null ? 'brak (0 zł wydatku)' : x2(v))
    s1.push(`Realny CPA: wczoraj ${cpaTxt(y.cpa)}, 7 pełnych dób (${d.from7} – ${d.yesterday}) ${cpaTxt(w.cpa)}. Realny ROAS: wczoraj ${roasTxt(y.roas)}, 7 dób ${roasTxt(w.roas)}.`)
    s1.push('(blended: wydatek Meta bez Cogni ÷ zamówienia Wix bez WSZTP; to nie jest CPA żadnej kampanii)')
    const cpa = cpaAlert(w.cpa, w.cpa, 7)
    const roas = roasAlert(w.roas, w.roas, 7)
    s1.push(`Progi (7 pełnych dób): ${SEVERITY_PL[cpa.severity] ?? cpa.severity}: ${cpa.message}; ${SEVERITY_PL[roas.severity] ?? roas.severity}: ${roas.message}.`)
    for (const a of [cpa, roas]) if (a.severity === 'red' || a.severity === 'amber') alerts.push(`${SEVERITY_PL[a.severity]}: ${a.message}`)
  } else if (!d.sales7.ok) s1.push(`Realny CPA/ROAS 7 dób: ${gap('zamówienia i wydatki 7 dób (profit-data)', d.sales7.error)}.`)
  sections.push({ id: 'sprzedaz', title: '1. SPRZEDAŻ (Wix) vs cel miesiąca', lines: s1 })

  // 2 — Meta
  const s2 = []
  if (!d.ads.ok) s2.push(gap('meta_ads_daily', d.ads.error))
  else {
    const rows = d.ads.value
    const yRows = rows.filter((r) => r.date === d.yesterday)
    if (!rows.length) s2.push(gap(`meta_ads_daily (brak wierszy ${d.from7} – ${d.yesterday})`))
    else {
      const sy = splitAdSpend(yRows)
      const s7 = splitAdSpend(rows)
      s2.push(`Wydatek wczoraj: ${zl(sy.total)}${sy.excluded > 0 ? ` (w tym poza blended, Cogni: ${zl(sy.excluded)})` : ''}; 7 pełnych dób: ${zl(s7.total)}.`)
      const byCampaign = new Map()
      for (const r of yRows) {
        const name = String(r.campaign_name ?? '').trim() || '—'
        byCampaign.set(name, (byCampaign.get(name) ?? 0) + Math.round(Number(r.spend ?? 0) * 100))
      }
      const camps = [...byCampaign.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
      s2.push(camps.length ? `Kampanie z wydatkiem wczoraj: ${camps.map(([n, c]) => `${n}: ${zl(c / 100)}`).join('; ')}.` : 'Kampanie z wydatkiem wczoraj: brak.')
      const purch = (list) => {
        const known = list.filter((r) => r.meta_purchases !== null && r.meta_purchases !== undefined)
        return { n: known.reduce((s, r) => s + Number(r.meta_purchases), 0), missing: list.length - known.length }
      }
      const py = purch(yRows)
      const p7 = purch(rows)
      s2.push(`Zakupy piksela Meta (nieporównywalne z zamówieniami Wix): wczoraj ${py.n}, 7 dób ${p7.n}${p7.missing ? `; bez danych o zakupach w wierszach: ${p7.missing}` : ''}.`)
      if (p7.missing) gaps.push(`BRAK DANYCH: meta_purchases (wiersze bez wartości: ${p7.missing})`)
      // ads with spend on each of the last 3 days and 0 pixel purchases on all of them
      const days3 = [addDays(d.today, -3), addDays(d.today, -2), d.yesterday]
      const byAd = new Map()
      for (const r of rows.filter((x) => days3.includes(x.date))) {
        const key = String(r.ad_id ?? r.ad_name ?? '')
        const e = byAd.get(key) ?? { name: String(r.ad_name ?? '—'), days: new Map() }
        const cur = e.days.get(r.date) ?? { spend: 0, purchases: 0, unknown: false }
        cur.spend += Number(r.spend ?? 0)
        if (r.meta_purchases === null || r.meta_purchases === undefined) cur.unknown = true
        else cur.purchases += Number(r.meta_purchases)
        e.days.set(r.date, cur)
        byAd.set(key, e)
      }
      const zero = []
      let unknown = 0
      for (const e of byAd.values()) {
        if (!days3.every((day) => (e.days.get(day)?.spend ?? 0) > 0)) continue
        const vals = days3.map((day) => e.days.get(day))
        if (vals.some((v) => v.unknown)) { unknown++; continue }
        if (vals.every((v) => v.purchases === 0)) zero.push({ name: e.name, spend: vals.reduce((s, v) => s + v.spend, 0) })
      }
      zero.sort((a, b) => b.spend - a.spend)
      s2.push(`Reklamy z wydatkiem i 0 zakupów piksela przez 3 dni (${days3[0]} – ${d.yesterday}): ${zero.length ? zero.map((z) => `${z.name}: ${zl(z.spend)}`).join('; ') : 'brak'}${unknown ? ` (bez danych o zakupach: ${unknown})` : ''}.`)
    }
  }
  sections.push({ id: 'meta', title: '2. REKLAMY META', lines: s2 })

  // 3 — webinar mails
  const s3 = []
  if (!d.mail.ok) s3.push(gap('maile webinarowe (webinar-mail store / Wix)', d.mail.error))
  else {
    const { health, last, todaySlot } = d.mail.value
    if (last) {
      const st = last.stats
      s3.push(`Ostatnia wysyłka: ${last.date} (${SLOT_PL[last.slot] ?? last.slot}), status: ${last.status}; Wix: ${st ? `dostarczone ${st.delivered}, otwarcia ${st.opened}, kliknięcia ${st.clicked}, odbite ${st.bounced ?? 'BRAK DANYCH: Wix statistics'}` : gap('statystyki Wix', last.statsError)}.`)
      if (todaySlot) s3.push(last.date === d.today ? `Dzisiejsza wysyłka (${SLOT_PL[todaySlot]}): ${last.status}.` : `Dzisiejsza wysyłka (${SLOT_PL[todaySlot]}): brak wpisu w logu (AUTO ${health.auto ? 'włączone' : 'wyłączone'}, PAUZA ${health.pauza ? 'włączona' : 'wyłączona'}).`)
      else s3.push('Dziś nie ma wysyłki (tylko wtorek i czwartek).')
    } else s3.push('Ostatnia wysyłka: brak wysyłek produkcyjnych w logu.')
    s3.push(`Kolejka szablonów: wtorek ${health.kolejka?.wtorek ?? 'BRAK DANYCH'}, czwartek ${health.kolejka?.czwartek ?? 'BRAK DANYCH'}. Odbiorcy: ${health.odbiorcy}, ${health.liczbaOdbiorcow ?? 'BRAK DANYCH: Wix Contacts'}.`)
    const codes = health.alarmy ?? null
    s3.push(`Alarmy maili: ${codes === null ? 'BRAK DANYCH: webinar-mail store' : codes.length ? codes.join(', ') : 'brak'}.`)
    for (const c of codes ?? []) alerts.push(`Maile: ${c}`)
  }
  sections.push({ id: 'maile', title: '3. MAILE WEBINAROWE', lines: s3 })

  // 4 — mail (stage 2)
  sections.push({ id: 'poczta', title: '4. POCZTA', lines: ['Wymaga połączenia Google (etap 2, plan w docs/brief-poczta.md).'] })

  // 5 — plan of the day
  const s5 = []
  if (!d.plan) s5.push(gap('stanley-wiedza/ (rytm dnia)'))
  else {
    if (d.plan.filarDnia) s5.push(`Filar dnia: ${d.plan.filarDnia}.`)
    for (const i of d.plan.items) s5.push(`${i.time ? `${i.time}${i.end ? `–${i.end}` : ''}` : 'bez godziny'} ${i.title}${i.kind === 'zadanie' ? ' [zadanie]' : ''}${i.overdue ? ' (zaległe)' : ''}${i.done ? ' ✓' : ''}`)
    if (d.tasksError) s5.push(gap('zadania (stanley store)', d.tasksError))
  }
  sections.push({ id: 'plan', title: '5. PLAN DNIA', lines: s5 })

  // 6 — attention
  const s6 = []
  for (const a of alerts) s6.push(a)
  for (const g of gaps) s6.push(g)
  if (!alerts.length && !gaps.length) s6.push('Brak aktywnych alarmów i braków danych w briefie.')
  for (const q of d.questions) s6.push(`Pytanie do Filipa: ${q}`)
  sections.push({ id: 'uwaga', title: '6. DO UWAGI', lines: s6 })

  const text = sections.map((s) => [s.title, ...s.lines.map((l) => `- ${l}`)].join('\n')).join('\n\n')
  let speech = `Brief na ${d.today}.`
  if (d.salesY.ok) speech += ` Wczoraj sprzedaż ${zl(salesOf(d.salesY.value).revenue)}.`
  if (d.mtdDays > 0 && d.salesMtd.ok) speech += ` Od początku miesiąca ${pct((salesOf(d.salesMtd.value).revenue / STRATEGIC_MONTHLY_GOAL) * 100)} celu.`
  if (alerts.length) speech += ` Do uwagi: ${alerts.length === 1 ? 'jedna sprawa' : `${alerts.length} sprawy`}.`
  return { sections, text, speech, alerts, gaps }
}

// ── the model's introduction, guarded ──────────────────────────────────────────

export const BRIEF_SYSTEM = `Jesteś Stanley, asystent operacyjny WCEEN (Filip). Dostajesz poranny brief, który policzył kod.
Napisz WSTĘP: 2–4 krótkie zdania po polsku, co jest dziś najważniejsze w tym briefie (sprzedaż względem celu, reklamy, maile, plan, alarmy).
Liczby: WYŁĄCZNIE te z briefu, przepisane dokładnie w tym samym formacie. Żadnych nowych liczb, szacunków, sum, procentów ani benchmarków:
serwer usuwa każde zdanie z liczbą spoza briefu. Gdy brief mówi „BRAK DANYCH”, nie zgaduj. Bez nagłówków, list i Markdownu. Zwracaj się „sir”.`

/** { intro, checked, removed, scrubbed } — intro null when the model is off, failed or every sentence was removed. */
export async function describeBrief(text, llm) {
  if (!llm) return { intro: null, checked: 0, removed: 0, scrubbed: 0, error: 'LLM not configured' }
  try {
    const raw = await llm(BRIEF_SYSTEM, `=== BRIEF (policzony przez kod) ===\n${text}\n\n=== ZADANIE ===\nNapisz wstęp.`, { temperature: 0.4, max_tokens: 300, timeoutMs: 12000 })
    const s = scrubModelText(String(raw?.text ?? raw ?? '').replace(/^\s*(ANSWER|WSTĘP)\s*:\s*/i, '').trim())
    const v = verifyNumbers(s.text, buildAllowed({ reportText: text }))
    const intro = v.text.replace(/\s+/g, ' ').trim()
    return { intro: intro || null, checked: v.checked, removed: v.removed, scrubbed: s.secrets + s.tax, provider: raw?.provider ?? null, model: raw?.model ?? null }
  } catch (e) {
    return { intro: null, checked: 0, removed: 0, scrubbed: 0, error: String(e?.message ?? e).slice(0, 120) }
  }
}

// ── store ──────────────────────────────────────────────────────────────────────

export async function saveBrief(kv, brief, keep = BRIEF_CONFIG.keep) {
  await kv.setJSON(`brief/${brief.date}`, brief)
  const keys = (await kv.list('brief/')).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) await kv.delete(k)
  const claims = (await kv.list('brief-claim/')).sort()
  for (const k of claims.slice(0, Math.max(0, claims.length - keep))) await kv.delete(k)
}

export async function latestBrief(kv) {
  const keys = (await kv.list('brief/')).sort()
  return keys.length ? kv.getJSON(keys[keys.length - 1]) : null
}

export async function listBriefDates(kv) {
  return (await kv.list('brief/')).sort().map((k) => k.slice('brief/'.length))
}

/**
 * One run. Returns { status: 'skipped' | 'saved' | 'dry-run', reason?, brief? }.
 *   skipped: not 09:00 in Warsaw (unless force), or today's brief already claimed.
 *   dryRun: computes and returns the brief, saves nothing, notifies nobody.
 * notify(brief) is called after a save (web push, P5); its failure never loses the brief.
 */
export async function runDailyBrief({ now = new Date(), deps, llm = null, dryRun = false, force = false, notify = null }) {
  if (!force && !isBriefHour(now)) return { status: 'skipped', reason: 'not-brief-hour' }
  const today = warsawParts(now).date
  if (!dryRun && !(await deps.kv.setJSONIfNew(`brief-claim/${today}`, { at: now.toISOString() }))) return { status: 'skipped', reason: 'already-done' }
  const data = await gatherBriefData({ now, deps })
  const r = renderBrief(data)
  const d = await describeBrief(r.text, llm)
  const brief = {
    date: today,
    createdAt: now.toISOString(),
    title: `Brief dnia ${today}`,
    intro: d.intro,
    sections: r.sections,
    text: d.intro ? `${d.intro}\n\n${r.text}` : r.text,
    speech: d.intro ?? r.speech,
    alerts: r.alerts,
    gaps: r.gaps,
    llm: { used: Boolean(d.intro), provider: d.provider ?? null, model: d.model ?? null, checked: d.checked, removed: d.removed, error: d.error ?? null },
    dryRun,
  }
  if (dryRun) return { status: 'dry-run', brief }
  await saveBrief(deps.kv, brief)
  let notified = null
  if (notify) {
    try { notified = await notify(brief) } catch (e) { notified = { error: String(e?.message ?? e).slice(0, 160) } }
  }
  return { status: 'saved', brief, notified }
}

/** The instant of 09:00 Warsaw on a date (for tests and the dry run). */
export function briefInstant(date) {
  return warsawLocalToUtc(date, `${String(BRIEF_CONFIG.hour).padStart(2, '0')}:00`)
}

