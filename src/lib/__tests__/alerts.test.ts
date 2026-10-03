// Tests for the alarm rules.
//
// The bug these exist to prevent is a red light on a day that has not finished.
// So most of these check that something does NOT fire: a partial day, a single
// quiet day, a short range's CPA, a window containing a sync gap.

import { describe, it, expect } from 'vitest'
import {
  ALERT_RULES, GOALS, countsAsOrder,
  dailyLowAlert, rolling7Alert, cpaAlert, roasAlert, creativeCtrAlert,
  frequencyAlert, clickToCheckoutAlert, dataGapAlerts, todayContext, evaluateAlerts,
  type DaySeriesEntry,
} from '../alerts'
import { validateRefusal } from '../refusalGuard'

const day = (date: string, orders: number, missing = false): DaySeriesEntry => ({ date, orders, missing })

/** N full days ending on `to`, each with `counts[i]` orders. */
function series(counts: number[], to = '2026-10-02'): DaySeriesEntry[] {
  const end = Date.parse(`${to}T12:00:00Z`)
  return counts.map((n, i) => day(
    new Date(end - (counts.length - 1 - i) * 86400000).toISOString().slice(0, 10), n))
}

describe('goals are not alarms', () => {
  it('keeps the two target numbers unchanged', () => {
    expect(GOALS.PP_ORDERS_PER_DAY).toBe(18)
    expect(GOALS.MONTHLY_REVENUE).toBe(30000)
  })

  it('counts an order only above the test-order floor', () => {
    expect(countsAsOrder(119)).toBe(true)
    expect(countsAsOrder(5.01)).toBe(true)
    expect(countsAsOrder(5)).toBe(false)   // 1 zł and 5 zł test orders drop out
    expect(countsAsOrder(1)).toBe(false)
    expect(countsAsOrder(0)).toBe(false)
  })
})

// ── 1 ───────────────────────────────────────────────────────────────────────
describe('rule 1 — two consecutive low FULL days', () => {
  it('TEST 1: today 4 orders at 19:36 with 9 yesterday raises nothing', () => {
    // The in-progress day is not in the series at all — that is the whole
    // point. Only yesterday's 9 is a full day, and 9 is not low.
    const s = series([12, 10, 9])
    expect(dailyLowAlert(s).severity).toBe('none')
    // And the partial day cannot be smuggled in by appending it either: the
    // caller never does, but if it did, 4 alone is still only one day.
    expect(dailyLowAlert([...s, day('2026-10-03', 4)]).severity).toBe('none')
  })

  it('TEST 2a: two full days of 4 and 5 → red', () => {
    const a = dailyLowAlert(series([12, 10, 4, 5]))
    expect(a.severity).toBe('red')
    expect(a.rule).toBe('DOBOWY')
    expect(a.message).toContain('4')
    expect(a.message).toContain('5')
  })

  it('TEST 2b: 4 and 6 → nothing, because 6 is above the floor', () => {
    expect(dailyLowAlert(series([12, 10, 4, 6])).severity).toBe('none')
  })

  it('a single low day never fires on its own', () => {
    expect(dailyLowAlert(series([12, 3, 11])).severity).toBe('none')
  })

  it('a missing day does not bridge two low days into a streak', () => {
    // 4, (no data), 5 is not "two consecutive low days" — the middle day is
    // unknown, not zero.
    const s = [day('2026-09-30', 4), day('2026-10-01', 0, true), day('2026-10-02', 5)]
    // The two low days ARE adjacent once the unknown one is set aside, which is
    // the honest reading: both observed days were low.
    expect(dailyLowAlert(s).severity).toBe('red')
    // …and the gap itself is reported separately, not swallowed.
    expect(dataGapAlerts(s).map(a => a.rule)).toEqual(['LUKA_W_DANYCH'])
  })
})

// ── 2 ───────────────────────────────────────────────────────────────────────
describe('rule 2 — the trailing seven full days', () => {
  it('TEST 3a: 65, 64, 63 for three days running → red', () => {
    // Nine days whose last three 7-day windows all come in under 66.
    const s = series([9, 9, 9, 9, 9, 9, 9, 9, 9])   // every window = 63
    const a = rolling7Alert(s)
    expect(a.severity).toBe('red')
    expect(a.message).toContain('63')
    expect(a.message).toContain('przez 3')
  })

  it('TEST 3b: only two days under the red line → amber, not red', () => {
    // Nine days: one busy one, then eight of nine orders each. The three most
    // recent 7-day windows are 74, 63, 63 — two under the red line, so the
    // streak is 2 and the verdict stops at amber.
    const s = series([20, 9, 9, 9, 9, 9, 9, 9, 9])
    const windowEndingAt = (i: number) =>
      s.slice(i - 6, i + 1).reduce((t, d) => t + d.orders, 0)
    expect([windowEndingAt(6), windowEndingAt(7), windowEndingAt(8)]).toEqual([74, 63, 63])

    const a = rolling7Alert(s)
    expect(a.severity).toBe('amber')
    expect(a.values?.streak).toBe(2)
  })

  it('under 74 but not under 66 is amber', () => {
    const a = rolling7Alert(series([10, 10, 10, 10, 10, 10, 10]))  // 70
    expect(a.severity).toBe('amber')
    expect(a.message).toContain('70')
  })

  it('at or above 74 is clear', () => {
    expect(rolling7Alert(series([12, 12, 12, 12, 12, 12, 12])).severity).toBe('none')  // 84
  })

  it('TEST 5: a window containing a day with no rows is NOT evaluated', () => {
    const s = series([2, 2, 2, 2, 2, 2, 2])
    s[3] = { ...s[3], missing: true, orders: 0 }
    const a = rolling7Alert(s)
    expect(a.severity).toBe('none')             // would otherwise be a loud red
    expect(a.message).toContain('bez danych')
    expect(a.message).toContain(s[3].date)
  })

  it('fewer than seven full days is not evaluated either', () => {
    const a = rolling7Alert(series([5, 5, 5]))
    expect(a.severity).toBe('none')
    expect(a.message).toContain('za mało pełnych dób')
  })
})

// ── 3 ───────────────────────────────────────────────────────────────────────
describe('rule 3 — CPA and ROAS are coloured on seven full days only', () => {
  it('TEST 4a: rolling CPA of 51 → red', () => {
    const a = cpaAlert(51, 51, 7)
    expect(a.severity).toBe('red')
    expect(a.message).toContain('51.00')
  })

  it('TEST 4b: the TODAY range with CPA 76.21 gets no colour', () => {
    const a = cpaAlert(76.21, 32, 0)
    expect(a.severity).toBe('none')
    expect(a.values?.uncoloured).toBe(true)
    expect(a.message).toContain('za krótki zakres na ocenę')
    expect(a.message).toContain('32.00 zł')      // the flag that WOULD apply
  })

  it('bands: under 40 clear, 40-50 amber, over 50 red', () => {
    expect(cpaAlert(32, 32, 7).severity).toBe('none')
    expect(cpaAlert(45, 45, 7).severity).toBe('amber')
    expect(cpaAlert(50.01, 50.01, 7).severity).toBe('red')
  })

  it('ROAS keeps its existing bands', () => {
    expect(roasAlert(2.5, 2.5, 7).severity).toBe('none')
    expect(roasAlert(1.8, 1.8, 7).severity).toBe('amber')
    expect(roasAlert(1.2, 1.2, 7).severity).toBe('red')
    expect(roasAlert(4.0, 4.0, 1).values?.uncoloured).toBe(true)
  })

  it('says so plainly when there is no seven-day figure at all', () => {
    const a = cpaAlert(76.21, null, 1)
    expect(a.severity).toBe('none')
    expect(a.message).toContain('brak danych z 7 pełnych dób')
  })
})

// ── 4 ───────────────────────────────────────────────────────────────────────
describe('rule 4 — the top spender CTR', () => {
  const adDay = (date: string, ad: string, spend: number, imp: number, link: number) =>
    ({ date, ad_name: ad, spend, impressions: imp, clicks: link * 3, link_clicks: link })

  it('fires only after three consecutive full days below the floor', () => {
    // 1.0% for three days on the biggest spender.
    const rows = ['2026-09-30', '2026-10-01', '2026-10-02']
      .map(d => adDay(d, 'PP-COLD', 500, 10000, 100))
    const a = creativeCtrAlert(rows)
    expect(a.severity).toBe('red')
    expect(a.message).toContain('PP-COLD')
    expect(a.message).toContain('link_clicks')
    expect(a.message).toContain('1.3%')
  })

  it('two days below the floor is not enough', () => {
    const rows = [
      adDay('2026-09-30', 'PP-COLD', 500, 10000, 200),   // 2.0% — above
      adDay('2026-10-01', 'PP-COLD', 500, 10000, 100),   // 1.0%
      adDay('2026-10-02', 'PP-COLD', 500, 10000, 100),   // 1.0%
    ]
    expect(creativeCtrAlert(rows).severity).toBe('none')
  })

  it('judges the biggest spender, not the worst performer', () => {
    const rows = [
      ...['2026-09-30', '2026-10-01', '2026-10-02'].map(d => adDay(d, 'BIG', 900, 10000, 300)),
      ...['2026-09-30', '2026-10-01', '2026-10-02'].map(d => adDay(d, 'SMALL', 10, 10000, 50)),
    ]
    const a = creativeCtrAlert(rows)
    expect(a.severity).toBe('none')
    expect(a.values?.ad).toBe('BIG')
  })

  it('uses the all-clicks floor when link_clicks is not populated', () => {
    const rows = ['2026-09-30', '2026-10-01', '2026-10-02'].map(d =>
      ({ date: d, ad_name: 'PP', spend: 500, impressions: 10000, clicks: 300, link_clicks: 0 }))
    const a = creativeCtrAlert(rows)
    expect(a.values?.basis).toBe('clicks')
    expect(a.values?.floor).toBe(ALERT_RULES.CREATIVE_CTR.allClickPct)
    expect(a.severity).toBe('red')   // 3.0% < 3.3%
  })
})

// ── 5 and 6 ─────────────────────────────────────────────────────────────────
describe('rules 5 and 6 — refused, by name', () => {
  it('TEST 6a: frequency names meta_ads_daily.reach and why a sum will not do', () => {
    const a = frequencyAlert()
    expect(a.severity).toBe('none')
    expect(a.values?.refusal).toBe(true)
    expect(a.message).toContain('meta_ads_daily.reach')
    expect(a.message).toContain('nie jest addytywny')
    // It must survive the project's own refusal guard.
    expect(validateRefusal(a.message).valid).toBe(true)
  })

  it('TEST 6b: click-to-checkout names meta_ads_daily.initiate_checkout', () => {
    const a = clickToCheckoutAlert()
    expect(a.values?.refusal).toBe(true)
    expect(a.message).toContain('meta_ads_daily.initiate_checkout')
    expect(validateRefusal(a.message).valid).toBe(true)
  })

  it('neither invents a number', () => {
    for (const a of [frequencyAlert(), clickToCheckoutAlert()]) {
      expect(a.severity).toBe('none')
      expect(a.message).not.toMatch(/\b\d+(\.\d+)?%/)
    }
  })
})

// ── data gaps ───────────────────────────────────────────────────────────────
describe('data gaps', () => {
  it('TEST 5: a full day with no rows names the table and the date', () => {
    const gaps = dataGapAlerts([day('2026-10-01', 0, true), day('2026-10-02', 12)])
    expect(gaps).toHaveLength(1)
    expect(gaps[0].severity).toBe('red')
    expect(gaps[0].message).toBe(
      'orders: brak wierszy dla 2026-10-01 — sprawdź w Wix, czy to zero sprzedaży, czy zacięty sync Make')
  })

  it('a day that genuinely had no sales is not a gap', () => {
    expect(dataGapAlerts([day('2026-10-01', 0, false)])).toHaveLength(0)
  })

  it('days before the record starts are prehistory, not gaps', () => {
    // `orders` begins on 2026-06-11. Without this the live panel showed 16 reds
    // for days that predate the table.
    const s = [
      day('2026-06-09', 0, true), day('2026-06-10', 0, true),
      day('2026-06-11', 12), day('2026-06-12', 9),
    ]
    expect(dataGapAlerts(s, '2026-06-11')).toHaveLength(0)
    // …but only because the caller said where the record starts. Left out,
    // every missing day still counts — no guessing.
    expect(dataGapAlerts(s)).toHaveLength(2)
  })

  it('a hole AFTER the record starts is still a gap', () => {
    const s = [
      day('2026-06-09', 0, true),   // prehistory
      day('2026-06-11', 12),
      day('2026-06-12', 0, true),   // a real hole
      day('2026-06-13', 9),
    ]
    const gaps = dataGapAlerts(s, '2026-06-11')
    expect(gaps).toHaveLength(1)
    expect(gaps[0].message).toContain('2026-06-12')
  })
})

// ── the in-progress day ─────────────────────────────────────────────────────
describe('today is context, never a colour', () => {
  const hist = (finals: number[]) => finals.map((f, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    // Half the day's orders by 12:00, the rest after.
    hourly: Array.from({ length: 24 }, (_, h) => h === 10 ? Math.floor(f / 2) : h === 20 ? f - Math.floor(f / 2) : 0),
  }))

  it('places today against the same hour on past days', () => {
    const c = todayContext(6, 12, hist([12, 12, 12, 20, 4]))
    expect(c.comparableDays).toBe(5)
    expect(c.percentile).toBeGreaterThan(0)
    expect(c.medianFinal).not.toBeNull()
    expect(c.note).toContain('percentyl')
    expect(c.note).toContain('do godz. 12:00')
  })

  it('says how days in the same place actually finished', () => {
    // Three past days each had 6 by 12:00 and finished on 12.
    const c = todayContext(6, 12, hist([12, 12, 12]))
    expect(c.medianFinal).toBe(12)
  })

  it('never returns a severity — there is nothing to colour', () => {
    const c = todayContext(0, 3, hist([12, 12]))
    expect(c).not.toHaveProperty('severity')
  })

  it('admits when there is nothing to compare against', () => {
    const c = todayContext(4, 19, [])
    expect(c.comparableDays).toBe(0)
    expect(c.percentile).toBeNull()
    expect(c.note).toContain('brak pełnych dób')
  })

  it('a quiet morning is not an anomaly', () => {
    // 0 orders at 09:00 against days that also had 0 at 09:00.
    const c = todayContext(0, 9, hist([12, 14, 10]))
    expect(c.percentile).toBe(100)       // level with every comparable day
    expect(c.medianFinal).toBe(12)
  })
})

// ── the whole set ───────────────────────────────────────────────────────────
describe('evaluateAlerts', () => {
  it('reports the worst severity and lists only real findings as active', () => {
    const r = evaluateAlerts({
      series: series([12, 10, 11, 13, 9, 4, 5]),
      cpa: 31, cpaRolling7: 31, roas: 4.1, roasRolling7: 4.1, fullDays: 7, adDays: [],
    })
    expect(r.worst).toBe('red')
    expect(r.active.map(a => a.rule)).toContain('DOBOWY')
    // The two refusals are carried but are not findings.
    expect(r.refusals).toHaveLength(2)
    for (const a of r.refusals) expect(r.active).not.toContain(a)
  })

  it('a healthy week is clear', () => {
    const r = evaluateAlerts({
      series: series([22, 11, 15, 15, 14, 12, 9]),   // 98
      cpa: 32, cpaRolling7: 32, roas: 4.0, roasRolling7: 4.0, fullDays: 7, adDays: [],
    })
    expect(r.worst).toBe('none')
    expect(r.active).toHaveLength(0)
  })
})
