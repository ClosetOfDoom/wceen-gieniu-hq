// ═══════════════════════════════════════════════════════════════════════════════
// alertRules — the ONE place that decides what is red.
//
// A GOAL and an ALARM are different things and this module keeps them apart:
//
//   GOAL   how far through a target we are. 18 PP a day, 30 000 PLN a month.
//          Always a progress bar, never red, never the word "alarm". A target
//          you are 40% of the way through at 10 a.m. is not a fault.
//
//   ALARM  something is wrong. Only alarms may be red, and every one of them is
//          measured over WHOLE Warsaw days — never a partial day, never a
//          linear hourly pace, never a single day's CPA.
//
// WHY THE SPLIT
// ---------------------------------------------------------------------------
// The old Goal Progress bar prorated the daily PP target by hours elapsed
// (18 × hours/24) and then coloured the result. At 09:00 with three orders in
// it printed "check technicals — abnormally low", which is not a finding: it is
// the arithmetic of a day that has not happened yet. Every alarm here needs at
// least one complete day before it can fire, and most need seven.
//
// Thresholds come from the measured distribution of daily paid orders since
// 2026-06-11 (the first day `orders` has rows for) — see the "Cele vs alarmy"
// section of the operational brain for the figures behind each one.
// ═══════════════════════════════════════════════════════════════════════════════

// ── constants ────────────────────────────────────────────────────────────────

/** Progress targets. NOT alarm thresholds — these never colour anything red. */
export const GOALS = {
  /** Pakiet Pamięciowy orders per FULL day. */
  PP_ORDERS_PER_DAY: 18,
  /** PLN per calendar month, prorated to the range being shown. */
  MONTHLY_REVENUE: 30000,
}

export const ALERT_RULES = {
  /** An order below this is a test, not a sale. */
  ORDER_MIN_AMOUNT_PLN: 5,

  /** 1 — two consecutive full days at or under this many orders. */
  DAILY_LOW: { maxOrders: 5, consecutiveDays: 2 },

  /** 2 — the trailing 7 FULL days. p10 of that window is 65, p25 is 72. */
  ROLLING_7: { windowDays: 7, amberBelow: 74, redBelow: 66, redStreakDays: 3 },

  /** 3 — CPA and ROAS are only ever coloured on 7 full days. */
  CPA:  { windowDays: 7, green: 40, amber: 50, doNotScale: 60 },
  ROAS: { windowDays: 7, healthy: 2.0, watch: 1.5 },

  /**
   * 4 — the biggest spender of the last 7 full days, below its CTR floor for
   * 3 consecutive full days.
   *
   * meta_ads_daily.ctr exists but the ingest deliberately does not write it
   * (src/lib/meta/insights.ts), so CTR is computed here. link_clicks is the
   * meaningful numerator for a landing-page funnel — it is action_type
   * 'link_click', i.e. people who actually went to the page — so the floor is
   * the link-click one. The all-clicks floor is kept for the case where only
   * `clicks` is populated.
   */
  CREATIVE_CTR: { windowDays: 7, consecutiveDays: 3, linkClickPct: 1.3, allClickPct: 3.3 },

  /** 5 — needs a range-level reach. See frequencyAlert(). */
  FREQUENCY: { max: 2.0 },

  /** 6 — needs checkout initiations. See clickToCheckoutAlert(). */
  CLICK_TO_CHECKOUT: { minPct: 12, consecutiveDays: 2 },

  /** How far back the in-progress day is compared against. */
  TODAY_PERCENTILE_WINDOW_DAYS: 120,
}

/** An order that counts: paid, a real product, above the test-order floor. */
export function countsAsOrder(amount) {
  return Number(amount) > ALERT_RULES.ORDER_MIN_AMOUNT_PLN
}

// ── shapes ───────────────────────────────────────────────────────────────────
//
// `series` is always an array of FULL Warsaw days, oldest first:
//   { date: 'YYYY-MM-DD', orders: number, missing: boolean }
// `missing` means `orders` had no rows at all for that day — which is not the
// same as a day on which nobody bought anything, and is never treated as zero.

/** @returns {{severity:'red'|'amber'|'none', rule:string, message:string, values?:object}} */
const alert = (severity, rule, message, values) => ({ severity, rule, message, values })
const noAlert = (rule) => alert('none', rule, '')

const last = (series, n) => series.slice(Math.max(0, series.length - n))
const sumOrders = (window) => window.reduce((s, d) => s + d.orders, 0)
const hasMissing = (window) => window.some(d => d.missing)

// ── 1. two consecutive low full days ────────────────────────────────────────

export function dailyLowAlert(series) {
  const R = ALERT_RULES.DAILY_LOW
  const full = series.filter(d => !d.missing)
  for (let i = full.length - 1; i >= R.consecutiveDays - 1; i--) {
    const window = full.slice(i - R.consecutiveDays + 1, i + 1)
    if (window.every(d => d.orders <= R.maxOrders)) {
      const detail = window.map(d => `${d.date}: ${d.orders}`).join(', ')
      return alert('red', 'DOBOWY',
        `${R.consecutiveDays} kolejne pełne doby z ≤ ${R.maxOrders} zamówieniami (${detail})`,
        { days: window })
    }
  }
  return noAlert('DOBOWY')
}

// ── 2. the trailing seven full days ─────────────────────────────────────────

export function rolling7Alert(series) {
  const R = ALERT_RULES.ROLLING_7
  const window = last(series, R.windowDays)

  if (window.length < R.windowDays) {
    return alert('none', 'KROCZĄCY_7',
      `za mało pełnych dób na ocenę (${window.length}/${R.windowDays})`,
      { days: window.length })
  }
  if (hasMissing(window)) {
    const gaps = window.filter(d => d.missing).map(d => d.date)
    return alert('none', 'KROCZĄCY_7',
      `okno zawiera doby bez danych (${gaps.join(', ')}) — alarm nieliczony, patrz LUKA W DANYCH`,
      { gaps })
  }

  const total = sumOrders(window)

  // Red needs the window to have been under the red line for three days running,
  // so one quiet week does not go red on its own.
  let streak = 0
  for (let end = series.length; end >= R.windowDays; end--) {
    const w = series.slice(end - R.windowDays, end)
    if (hasMissing(w)) break
    if (sumOrders(w) < R.redBelow) streak++
    else break
    if (streak >= R.redStreakDays) break
  }
  if (streak >= R.redStreakDays) {
    return alert('red', 'KROCZĄCY_7',
      `suma z ${R.windowDays} pełnych dób = ${total}, poniżej ${R.redBelow} przez ${streak} kolejne dni`,
      { total, streak })
  }
  if (total < R.amberBelow) {
    return alert('amber', 'KROCZĄCY_7',
      `suma z ${R.windowDays} pełnych dób = ${total}, poniżej ${R.amberBelow}`
      + (total < R.redBelow ? ` (poniżej ${R.redBelow} od ${streak} dni — czerwony przy ${R.redStreakDays})` : ''),
      { total, streak })
  }
  return alert('none', 'KROCZĄCY_7', `suma z ${R.windowDays} pełnych dób = ${total}`, { total })
}

// ── 3. CPA and ROAS, coloured only on seven full days ───────────────────────

/**
 * @param value     the figure for the range being displayed
 * @param rolling7  the same figure computed over the last 7 FULL days, or null
 * @param fullDays  how many FULL days the displayed range covers
 */
export function cpaAlert(value, rolling7, fullDays) {
  return thresholdAlert('CPA', value, rolling7, fullDays, ALERT_RULES.CPA.windowDays, (v) => {
    const R = ALERT_RULES.CPA
    if (v > R.amber) return ['red', `CPA ${v.toFixed(2)} zł z 7 pełnych dób — powyżej ${R.amber}`]
    if (v >= R.green) return ['amber', `CPA ${v.toFixed(2)} zł z 7 pełnych dób — pasmo ${R.green}–${R.amber}`]
    return ['none', `CPA ${v.toFixed(2)} zł z 7 pełnych dób`]
  }, (v) => `${v.toFixed(2)} zł`)
}

export function roasAlert(value, rolling7, fullDays) {
  return thresholdAlert('ROAS', value, rolling7, fullDays, ALERT_RULES.ROAS.windowDays, (v) => {
    const R = ALERT_RULES.ROAS
    if (v < R.watch) return ['red', `ROAS ${v.toFixed(2)}x z 7 pełnych dób — poniżej ${R.watch}`]
    if (v < R.healthy) return ['amber', `ROAS ${v.toFixed(2)}x z 7 pełnych dób — pasmo ${R.watch}–${R.healthy}`]
    return ['none', `ROAS ${v.toFixed(2)}x z 7 pełnych dób`]
  }, (v) => `${v.toFixed(2)}x`)
}

function thresholdAlert(rule, value, rolling7, fullDays, need, grade, fmt) {
  // A range shorter than the window still shows its number — it just does not
  // get a colour, and it says what the colour WOULD be based on.
  if (fullDays < need) {
    const flag = rolling7 == null
      ? 'brak danych z 7 pełnych dób'
      : `flaga z 7 pełnych dób: ${fmt(rolling7)}`
    return alert('none', rule, `za krótki zakres na ocenę — ${flag}`,
      { value, rolling7, uncoloured: true })
  }
  if (rolling7 == null) {
    return alert('none', rule, 'brak danych z 7 pełnych dób', { value, uncoloured: true })
  }
  const [severity, message] = grade(rolling7)
  return alert(severity, rule, message, { value, rolling7 })
}

// ── 4. the top spender's CTR ────────────────────────────────────────────────

/**
 * @param adDays  per-ad, per-day rows for the last 7 full days:
 *                { date, ad_name, spend, impressions, clicks, link_clicks }
 */
export function creativeCtrAlert(adDays) {
  const R = ALERT_RULES.CREATIVE_CTR
  if (!adDays || adDays.length === 0) {
    return alert('none', 'KREACJA_CTR', 'brak wierszy meta_ads_daily dla okna 7 pełnych dób')
  }

  const spendByAd = new Map()
  for (const r of adDays) {
    const key = r.ad_name ?? r.ad_id ?? '—'
    spendByAd.set(key, (spendByAd.get(key) ?? 0) + (Number(r.spend) || 0))
  }
  const [topAd] = [...spendByAd.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (!topAd) return alert('none', 'KREACJA_CTR', 'brak reklamy z wydatkiem w oknie')

  // link_clicks is the numerator whenever the ingest populated it; the floor
  // moves with the numerator, because the two measure different things.
  const rows = adDays.filter(r => (r.ad_name ?? r.ad_id ?? '—') === topAd)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const usesLink = rows.some(r => Number(r.link_clicks) > 0)
  const floor = usesLink ? R.linkClickPct : R.allClickPct
  const basis = usesLink ? 'link_clicks' : 'clicks'

  const ctrOf = (r) => {
    const imp = Number(r.impressions) || 0
    const num = Number(usesLink ? r.link_clicks : r.clicks) || 0
    return imp > 0 ? (num / imp) * 100 : null
  }

  let streak = 0
  const below = []
  for (let i = rows.length - 1; i >= 0; i--) {
    const ctr = ctrOf(rows[i])
    if (ctr == null) break
    if (ctr < floor) { streak++; below.unshift({ date: rows[i].date, ctr }) } else break
  }
  if (streak >= R.consecutiveDays) {
    const detail = below.map(b => `${b.date}: ${b.ctr.toFixed(2)}%`).join(', ')
    return alert('red', 'KREACJA_CTR',
      `"${topAd}" — CTR (${basis}) poniżej ${floor}% przez ${streak} kolejne pełne doby (${detail})`,
      { ad: topAd, basis, floor, streak })
  }
  const latest = ctrOf(rows[rows.length - 1])
  return alert('none', 'KREACJA_CTR',
    `"${topAd}" — CTR (${basis}) ${latest == null ? 'brak' : latest.toFixed(2) + '%'}, próg ${floor}%`,
    { ad: topAd, basis, floor, streak })
}

// ── 5 and 6. the two rules the data cannot support ──────────────────────────
//
// Both return a refusal that names the table and the column, because a rule
// that silently does not run is worse than one that says why. The strings are
// shaped to pass validateRefusal() in src/lib/refusalGuard.ts.

export function frequencyAlert() {
  return alert('none', 'CZĘSTOTLIWOŚĆ',
    'Nie mam tej danej. meta_ads_daily.reach nie istnieje w schemacie — Meta Insights API '
    + 'pobiera reach, ale ingest nie ma go gdzie zapisać. Częstotliwości nie da się policzyć '
    + 'z dziennych wierszy, bo zasięg nie jest addytywny: suma dobowych reach to nie reach '
    + 'zakresu. Potrzebny jest reach liczony przez Meta dla całego okna.',
    { refusal: true, table: 'meta_ads_daily', column: 'reach' })
}

export function clickToCheckoutAlert() {
  return alert('none', 'KLIK_DO_KASY',
    'Nie mam tej danej. meta_ads_daily.initiate_checkout nie istnieje w schemacie, a ingest '
    + 'z Meta Insights API zapisuje z actions wyłącznie link_click i zakupy. Bez finalizacji '
    + 'zakupu nie policzę przejścia z kliknięcia do kasy.',
    { refusal: true, table: 'meta_ads_daily', column: 'initiate_checkout' })
}

// ── data gaps ───────────────────────────────────────────────────────────────

/**
 * A full day with no rows at all in `orders` — a suspected stuck sync.
 *
 * `recordStartsOn` is the first day the table has ANY row for. Days before it
 * are prehistory, not failures: `orders` begins on 2026-06-11, and a window
 * reaching further back would otherwise report every earlier day as a stuck
 * sync — sixteen reds that mean nothing, which is the noise this module exists
 * to remove. A gap is a hole IN the record, not the absence of one.
 *
 * Left out, every missing day counts. That is the conservative default: a
 * caller that does not know where the record starts should not be guessing.
 */
export function dataGapAlerts(series, recordStartsOn = null) {
  const inRecord = recordStartsOn
    ? series.filter(d => d.date >= recordStartsOn)
    : series
  return inRecord.filter(d => d.missing).map(d => alert('red', 'LUKA_W_DANYCH',
    `orders: brak wierszy dla ${d.date} — sprawdź w Wix, czy to zero sprzedaży, czy zacięty sync Make`,
    { date: d.date }))
}

// ── the in-progress day: context, never a colour ────────────────────────────

/**
 * Where today sits against the same hour on recent days.
 *
 * Replaces "18 × hours/24", which assumed orders arrive at a constant rate and
 * therefore called every morning abnormal. This compares like with like: how
 * many orders had landed by this hour on each of the last N full days, and how
 * those days finished.
 *
 * @param ordersSoFar  orders today up to and including the current hour
 * @param hour         current Warsaw hour, 0-23
 * @param history      full days, each { date, hourly: number[24] }
 */
export function todayContext(ordersSoFar, hour, history) {
  const N = ALERT_RULES.TODAY_PERCENTILE_WINDOW_DAYS
  const recent = last(history ?? [], N).filter(d => Array.isArray(d.hourly) && d.hourly.length === 24)
  if (recent.length === 0) {
    return { ordersSoFar, hour, comparableDays: 0, percentile: null, medianFinal: null,
      note: 'brak pełnych dób do porównania' }
  }

  const toHour = (d) => d.hourly.slice(0, hour + 1).reduce((s, n) => s + n, 0)
  const atThisHour = recent.map(d => ({ date: d.date, soFar: toHour(d), final: d.hourly.reduce((s, n) => s + n, 0) }))

  const notAhead = atThisHour.filter(d => d.soFar <= ordersSoFar)
  const percentile = Math.round((notAhead.length / atThisHour.length) * 100)

  // How days that were in the same place at this hour actually ended.
  const finals = notAhead.map(d => d.final).sort((a, b) => a - b)
  const medianFinal = finals.length === 0 ? null
    : finals.length % 2 ? finals[(finals.length - 1) / 2]
    : (finals[finals.length / 2 - 1] + finals[finals.length / 2]) / 2

  return {
    ordersSoFar, hour,
    comparableDays: atThisHour.length,
    percentile,
    medianFinal,
    note: medianFinal == null
      ? `${ordersSoFar} do godz. ${hour}:00 — niżej niż każda z ${atThisHour.length} ostatnich pełnych dób o tej porze`
      : `${ordersSoFar} do godz. ${hour}:00 — percentyl ${percentile} z ${atThisHour.length} pełnych dób; `
        + `doby, które o tej porze miały nie więcej, kończyły medianą ${medianFinal}`,
  }
}

// ── everything at once ──────────────────────────────────────────────────────

/**
 * Every alarm, in one call. Only the entries with severity 'red' or 'amber'
 * are findings; the rest carry their measured value so a panel can show it
 * without re-deriving anything.
 */
export function evaluateAlerts({ series = [], cpa = null, cpaRolling7 = null, roas = null,
                                 roasRolling7 = null, fullDays = 0, adDays = [],
                                 recordStartsOn = null } = {}) {
  const all = [
    dailyLowAlert(series),
    rolling7Alert(series),
    cpaAlert(cpa, cpaRolling7, fullDays),
    roasAlert(roas, roasRolling7, fullDays),
    creativeCtrAlert(adDays),
    frequencyAlert(),
    clickToCheckoutAlert(),
    ...dataGapAlerts(series, recordStartsOn),
  ]
  return {
    all,
    active: all.filter(a => a.severity === 'red' || a.severity === 'amber'),
    refusals: all.filter(a => a.values?.refusal),
    worst: all.some(a => a.severity === 'red') ? 'red'
         : all.some(a => a.severity === 'amber') ? 'amber' : 'none',
  }
}
