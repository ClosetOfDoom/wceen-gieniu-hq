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
const SLOT_EN = { tuesday: 'Tuesday', thursday: 'Thursday' }

async function safe(fn) {
  try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: String(e?.message ?? e).replace(/[^\s@]+@[^\s@]+/g, '[e-mail]').slice(0, 160) } }
}

function daysInMonth(date) {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The INBOX section: numbers only. Customer access questions are the ones Stanley can answer from a template after approval. */
export function inboxLines(inbox, alerts = [], gap = (source, err) => `NO DATA: ${source}${err ? ` (${err})` : ''}`) {
  if (!inbox) return ['Inbox: Google is not connected yet. Open the Mail tab and press Connect Google.']
  if (!inbox.ok) return [gap('Gmail inbox', inbox.error)]
  const v = inbox.value
  if (!v || v.connected === false) return ['Inbox: Google is not connected yet. Open the Mail tab and press Connect Google.']
  const lines = []
  if (v.access > 0) {
    lines.push(`${v.access} customer message${v.access === 1 ? '' : 's'} about access to a product wait${v.access === 1 ? 's' : ''} for your approval of a template reply${v.unverified ? ` (${v.unverified} without a matching paid order: check those first)` : ''}.`)
    alerts.push(`Inbox: ${v.access} access request${v.access === 1 ? '' : 's'} waiting for approval`)
  } else lines.push('No customer access requests are waiting.')
  const other = (v.human ?? 0) + (v.sensitive ?? 0)
  if (other > 0) lines.push(`${other} other message${other === 1 ? '' : 's'} from people wait for you${v.sensitive ? ` (${v.sensitive} about invoices, refunds, legal or tax: Stanley never answers those)` : ''}${v.oldest ? `; the oldest is from ${String(v.oldest).slice(0, 10)}` : ''}.`)
  else lines.push('No other messages from people are waiting.')
  lines.push(`Ignored: ${v.automated ?? 0} automated and ${v.protected ?? 0} system, bank or authority messages (nothing is deleted).`)
  return lines
}

// ── data ───────────────────────────────────────────────────────────────────────

export async function gatherBriefData({ now, deps }) {
  const today = warsawParts(now).date
  const yesterday = addDays(today, -1)
  const from7 = addDays(today, -7)
  const from3 = addDays(today, -3)
  const monthStart = `${today.slice(0, 8)}01`
  const mtdDays = yesterday.slice(0, 7) === today.slice(0, 7) ? Number(yesterday.slice(8)) : 0

  const [salesY, salesMtd, sales7, ads, mail, inbox, tasks, ticks] = await Promise.all([
    safe(() => deps.sales(yesterday, yesterday)),
    mtdDays > 0 ? safe(() => deps.sales(monthStart, yesterday)) : Promise.resolve({ ok: true, value: null }),
    safe(() => deps.sales(from7, yesterday)),
    safe(() => deps.adRows(from7, yesterday)),
    safe(() => mailData(deps.mail, now)),
    deps.inbox ? safe(() => deps.inbox(now)) : Promise.resolve({ ok: true, value: null }),
    safe(() => listTasks(deps.kv)),
    safe(() => getDayTicks(deps.kv, today)),
  ])
  const k = deps.knowledge
  const plan = k ? dayPlan({ date: today, rhythm: k.rhythm, tasks: tasks.ok ? tasks.value : [], ticks: ticks.ok ? ticks.value : [] }) : null
  return {
    today, yesterday, from7, from3, monthStart, mtdDays, daysInMonth: daysInMonth(today),
    salesY, salesMtd, sales7, ads, mail, inbox, tasksError: tasks.ok ? null : tasks.error, plan,
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

const SEVERITY_EN = { none: 'OK', amber: 'WARNING', red: 'ALARM' }

/** { sections: [{ id, title, lines }], text, speech, alerts, gaps } — deterministic, from data only. */
export function renderBrief(d) {
  const gaps = []
  const alerts = []
  const gap = (source, err) => { const g = `NO DATA: ${source}${err ? ` (${err})` : ''}`; gaps.push(g); return g }
  const sections = []

  // 1 — sales
  const s1 = []
  if (d.salesY.ok) {
    const y = salesOf(d.salesY.value)
    s1.push(`Yesterday (${d.yesterday}): ${zl(y.revenue)}, orders: ${y.orders}.`)
  } else s1.push(`Yesterday (${d.yesterday}): ${gap('Wix orders (profit-data)', d.salesY.error)}.`)
  if (d.mtdDays === 0) s1.push(`Month to date: today is ${d.today}, the first day of the month, no full days yet.`)
  else if (d.salesMtd.ok) {
    const m = salesOf(d.salesMtd.value)
    const expected = (STRATEGIC_MONTHLY_GOAL * d.mtdDays) / d.daysInMonth
    s1.push(`Month to date (${d.monthStart} – ${d.yesterday}, days: ${d.mtdDays} of ${d.daysInMonth}): ${zl(m.revenue)} = ${pct((m.revenue / STRATEGIC_MONTHLY_GOAL) * 100)} of the ${zl(STRATEGIC_MONTHLY_GOAL)} goal (pro rata to yesterday: ${zl(expected)}).`)
  } else s1.push(`Month to date: ${gap('Wix orders (profit-data)', d.salesMtd.error)}.`)
  if (d.salesY.ok && d.sales7.ok) {
    const y = salesOf(d.salesY.value)
    const w = salesOf(d.sales7.value)
    const cpaTxt = (v) => (v == null ? 'none (0 orders)' : zl(v))
    const roasTxt = (v) => (v == null ? 'none (0 PLN spend)' : x2(v))
    s1.push(`Real CPA: yesterday ${cpaTxt(y.cpa)}, last 7 full days (${d.from7} – ${d.yesterday}) ${cpaTxt(w.cpa)}. Real ROAS: yesterday ${roasTxt(y.roas)}, 7 days ${roasTxt(w.roas)}.`)
    s1.push('(blended: Meta spend without Cogni ÷ Wix orders without WSZTP; this is not the CPA of any single campaign)')
    const cpa = cpaAlert(w.cpa, w.cpa, 7)
    const roas = roasAlert(w.roas, w.roas, 7)
    s1.push(`Thresholds (7 full days): ${SEVERITY_EN[cpa.severity] ?? cpa.severity}: ${cpa.message}; ${SEVERITY_EN[roas.severity] ?? roas.severity}: ${roas.message}.`)
    for (const a of [cpa, roas]) if (a.severity === 'red' || a.severity === 'amber') alerts.push(`${SEVERITY_EN[a.severity]}: ${a.message}`)
  } else if (!d.sales7.ok) s1.push(`Real CPA/ROAS, 7 days: ${gap('orders and spend, 7 days (profit-data)', d.sales7.error)}.`)
  sections.push({ id: 'sprzedaz', title: '1. SALES (Wix) vs the monthly goal', lines: s1 })

  // 2 — Meta
  const s2 = []
  if (!d.ads.ok) s2.push(gap('meta_ads_daily', d.ads.error))
  else {
    const rows = d.ads.value
    const yRows = rows.filter((r) => r.date === d.yesterday)
    if (!rows.length) s2.push(gap(`meta_ads_daily (no rows ${d.from7} – ${d.yesterday})`))
    else {
      const sy = splitAdSpend(yRows)
      const s7 = splitAdSpend(rows)
      s2.push(`Spend yesterday: ${zl(sy.total)}${sy.excluded > 0 ? ` (of which outside the blended figure, Cogni: ${zl(sy.excluded)})` : ''}; last 7 full days: ${zl(s7.total)}.`)
      const byCampaign = new Map()
      for (const r of yRows) {
        const name = String(r.campaign_name ?? '').trim() || '—'
        byCampaign.set(name, (byCampaign.get(name) ?? 0) + Math.round(Number(r.spend ?? 0) * 100))
      }
      const camps = [...byCampaign.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
      s2.push(camps.length ? `Campaigns with spend yesterday: ${camps.map(([n, c]) => `${n}: ${zl(c / 100)}`).join('; ')}.` : 'Campaigns with spend yesterday: none.')
      const purch = (list) => {
        const known = list.filter((r) => r.meta_purchases !== null && r.meta_purchases !== undefined)
        return { n: known.reduce((s, r) => s + Number(r.meta_purchases), 0), missing: list.length - known.length }
      }
      const py = purch(yRows)
      const p7 = purch(rows)
      s2.push(`Meta pixel purchases (not comparable with Wix orders): yesterday ${py.n}, 7 days ${p7.n}${p7.missing ? `; rows without purchase data: ${p7.missing}` : ''}.`)
      if (p7.missing) gaps.push(`NO DATA: meta_purchases (rows without a value: ${p7.missing})`)
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
      s2.push(`Ads with spend and 0 pixel purchases for 3 days (${days3[0]} – ${d.yesterday}): ${zero.length ? zero.map((z) => `${z.name}: ${zl(z.spend)}`).join('; ') : 'none'}${unknown ? ` (without purchase data: ${unknown})` : ''}.`)
    }
  }
  sections.push({ id: 'meta', title: '2. META ADS', lines: s2 })

  // 3 — webinar mails
  const s3 = []
  if (!d.mail.ok) s3.push(gap('webinar mails (webinar-mail store / Wix)', d.mail.error))
  else {
    const { health, last, todaySlot } = d.mail.value
    if (last) {
      const st = last.stats
      s3.push(`Last send: ${last.date} (${SLOT_EN[last.slot] ?? last.slot}), status: ${last.status}; Wix: ${st ? `delivered ${st.delivered}, opens ${st.opened}, clicks ${st.clicked}, bounced ${st.bounced ?? 'NO DATA: Wix statistics'}` : gap('Wix statistics', last.statsError)}.`)
      if (todaySlot) s3.push(last.date === d.today ? `Today's send (${SLOT_EN[todaySlot]}): ${last.status}.` : `Today's send (${SLOT_EN[todaySlot]}): no entry in the log (AUTO ${health.auto ? 'on' : 'off'}, PAUSE ${health.pauza ? 'on' : 'off'}).`)
      else s3.push('No send today (only Tuesday and Thursday).')
    } else s3.push('Last send: no production sends in the log.')
    s3.push(`Template queue: Tuesday ${health.kolejka?.wtorek ?? 'NO DATA'}, Thursday ${health.kolejka?.czwartek ?? 'NO DATA'}. Recipients: ${health.odbiorcy}, ${health.liczbaOdbiorcow ?? 'NO DATA: Wix Contacts'}.`)
    const codes = health.alarmy ?? null
    s3.push(`Mail alarms: ${codes === null ? 'NO DATA: webinar-mail store' : codes.length ? codes.join(', ') : 'none'}.`)
    for (const c of codes ?? []) alerts.push(`Mails: ${c}`)
  }
  sections.push({ id: 'maile', title: '3. WEBINAR MAILS', lines: s3 })

  // 4 — inbox (Gmail triage: counts only, no addresses, no subjects)
  sections.push({ id: 'poczta', title: '4. INBOX', lines: inboxLines(d.inbox, alerts, gap) })

  // 5 — plan of the day
  const s5 = []
  if (!d.plan) s5.push(gap('stanley-wiedza/ (day rhythm)'))
  else {
    if (d.plan.filarDnia) s5.push(`Pillar of the day: ${d.plan.filarDnia}.`)
    for (const i of d.plan.items) s5.push(`${i.time ? `${i.time}${i.end ? `–${i.end}` : ''}` : 'no time'} ${i.title}${i.kind === 'zadanie' ? ' [task]' : ''}${i.overdue ? ' (overdue)' : ''}${i.done ? ' ✓' : ''}`)
    if (d.tasksError) s5.push(gap('tasks (stanley store)', d.tasksError))
  }
  sections.push({ id: 'plan', title: "5. TODAY'S PLAN", lines: s5 })

  // 6 — attention
  const s6 = []
  for (const a of alerts) s6.push(a)
  for (const g of new Set(gaps)) s6.push(g) // the same gap from two sections is listed once
  if (!alerts.length && !gaps.length) s6.push('No active alarms and no data gaps in the brief.')
  for (const q of d.questions) s6.push(`Question for Filip: ${q}`)
  sections.push({ id: 'uwaga', title: '6. NEEDS ATTENTION', lines: s6 })

  const text = sections.map((s) => [s.title, ...s.lines.map((l) => `- ${l}`)].join('\n')).join('\n\n')
  // The spoken fallback (used when the model is off): English, with the day's plan, never a number the brief does not hold.
  let speech = `Brief for ${d.today}.`
  if (d.salesY.ok) speech += ` Yesterday's sales: ${zl(salesOf(d.salesY.value).revenue)}.`
  if (d.mtdDays > 0 && d.salesMtd.ok) speech += ` Month to date: ${pct((salesOf(d.salesMtd.value).revenue / STRATEGIC_MONTHLY_GOAL) * 100)} of the goal.`
  if (alerts.length) speech += ` ${alerts.length === 1 ? 'One matter needs' : `${alerts.length} matters need`} your attention.`
  const planned = d.plan ? d.plan.items.filter((i) => !i.done).slice(0, 5) : []
  if (planned.length) speech += ` Today: ${planned.map((i) => `${i.time ? `${i.time} ` : ''}${i.title}`).join('; ')}.`
  return { sections, text, speech, alerts, gaps }
}

// ── the model's introduction, guarded ──────────────────────────────────────────

export const BRIEF_SYSTEM = `You are STANLEY, the operations assistant of WCEEN, speaking to Filip ("sir"). You get this morning's brief, computed by code.
Write the SPOKEN BRIEFING in English: 5-9 short sentences, in this order: yesterday's sales against the monthly goal; anything that needs attention (alarms, data gaps); what is on today's plan, in time order (translate the Polish titles into English and say the time first); any question for Filip.
Numbers: ONLY those in the brief, copied exactly in the same format. No new numbers, estimates, sums, percentages or benchmarks: the server removes every sentence with a number that is not in the brief. When the brief says "NO DATA", do not guess. No headings, lists or Markdown. The first sentence carries information; no greeting.`

/** { intro, checked, removed, scrubbed } — intro null when the model is off, failed or every sentence was removed. */
export async function describeBrief(text, llm) {
  if (!llm) return { intro: null, checked: 0, removed: 0, scrubbed: 0, error: 'LLM not configured' }
  try {
    const raw = await llm(BRIEF_SYSTEM, `=== BRIEF (computed by code) ===\n${text}\n\n=== TASK ===\nWrite the spoken briefing in English.`, { temperature: 0.4, max_tokens: 500, timeoutMs: 14000 })
    const s = scrubModelText(String(raw?.text ?? raw ?? '').replace(/^\s*(ANSWER|SPEECH|INTRO|WSTĘP)\s*:\s*/i, '').trim())
    const v = verifyNumbers(s.text, buildAllowed({ reportText: text }))
    const intro = v.text.replace(/\s+/g, ' ').trim()
    return { intro: intro || null, checked: v.checked, removed: v.removed, scrubbed: s.secrets + s.tax, provider: raw?.provider ?? null, model: raw?.model ?? null }
  } catch (e) {
    return { intro: null, checked: 0, removed: 0, scrubbed: 0, error: String(e?.message ?? e).slice(0, 120) }
  }
}

// ── English data: Filip's own lines (the day's plan, the questions) are Polish; Stanley's output is English ──────

export const TRANSLATE_SYSTEM = `Translate each line into natural English for a business assistant (the lines are Polish; a line that is already English stays as it is).
Keep times, numbers, dates and the names of products, people, tools and files unchanged (WCEEN, Językozak, Wix, Meta, Cogni, WSZTP, ClickMeeting, Netlify...).
Return ONLY a JSON array of strings with exactly as many items as lines, in the same order. No comments.`

/** [{ lines, translated }] — the lines in English; unchanged when the model is off, fails or returns a wrong shape. */
export async function toEnglish(lines, llm) {
  const list = lines.map((l) => String(l ?? ''))
  if (!llm || !list.some((l) => l.trim())) return { lines: list, translated: 0 }
  try {
    const raw = await llm(TRANSLATE_SYSTEM, JSON.stringify(list), { temperature: 0, max_tokens: 800, timeoutMs: 14000 })
    const text = String(raw?.text ?? raw ?? '')
    const json = text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)
    const out = JSON.parse(json)
    if (!Array.isArray(out) || out.length !== list.length || out.some((x) => typeof x !== 'string')) return { lines: list, translated: 0 }
    const cleaned = out.map((x, i) => x.replace(/\s+/g, ' ').trim() || list[i])
    return { lines: cleaned, translated: cleaned.filter((x, i) => x !== list[i]).length }
  } catch {
    return { lines: list, translated: 0 }
  }
}

/** The gathered data with the plan items, the day's pillar and the questions in English (one model call). */
export async function englishData(data, llm) {
  const items = data.plan?.items ?? []
  const questions = data.questions ?? []
  const pillar = data.plan?.filarDnia ? [data.plan.filarDnia] : []
  const lines = [...items.map((i) => i.title), ...pillar, ...questions]
  if (!lines.length) return { data, translated: 0 }
  const t = await toEnglish(lines, llm)
  if (!t.translated) return { data, translated: 0 }
  const titles = t.lines.slice(0, items.length)
  const filar = pillar.length ? t.lines[items.length] : null
  const qs = t.lines.slice(items.length + pillar.length)
  return {
    translated: t.translated,
    data: {
      ...data,
      plan: data.plan ? { ...data.plan, filarDnia: filar ?? data.plan.filarDnia, items: items.map((i, k) => ({ ...i, title: titles[k] })) } : data.plan,
      questions: qs,
    },
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
export async function runDailyBrief({ now = new Date(), deps, llm = null, dryRun = false, force = false, notify = null, overwrite = false }) {
  if (!force && !overwrite && !isBriefHour(now)) return { status: 'skipped', reason: 'not-brief-hour' }
  const today = warsawParts(now).date
  // `overwrite` (the app asks for it when today's saved brief predates the English one): no claim, saved over today's
  // brief, nobody is notified a second time.
  if (!dryRun && !overwrite && !(await deps.kv.setJSONIfNew(`brief-claim/${today}`, { at: now.toISOString() }))) return { status: 'skipped', reason: 'already-done' }
  const gathered = await gatherBriefData({ now, deps })
  const tr = await englishData(gathered, llm)
  const data = tr.data
  const r = renderBrief(data)
  const d = await describeBrief(r.text, llm)
  const brief = {
    date: today,
    lang: 'en',
    createdAt: now.toISOString(),
    title: `Daily brief ${today}`,
    intro: d.intro,
    sections: r.sections,
    text: d.intro ? `${d.intro}\n\n${r.text}` : r.text,
    speech: d.intro ?? r.speech,
    alerts: r.alerts,
    gaps: r.gaps,
    llm: { used: Boolean(d.intro), provider: d.provider ?? null, model: d.model ?? null, checked: d.checked, removed: d.removed, error: d.error ?? null, translated: tr.translated },
    dryRun,
  }
  if (dryRun) return { status: 'dry-run', brief }
  await saveBrief(deps.kv, brief)
  let notified = null
  if (notify && !overwrite) {
    try { notified = await notify(brief) } catch (e) { notified = { error: String(e?.message ?? e).slice(0, 160) } }
  }
  return { status: 'saved', brief, notified }
}

/** The instant of 09:00 Warsaw on a date (for tests and the dry run). */
export function briefInstant(date) {
  return warsawLocalToUtc(date, `${String(BRIEF_CONFIG.hour).padStart(2, '0')}:00`)
}

