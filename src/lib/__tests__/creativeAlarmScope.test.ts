// The creative alarms (CTR, frequency, click→checkout) have thresholds measured
// on PP. They must read PP rows — not Cogni's, whose audience, offer and checkout
// those thresholds were never calibrated on.
import { describe, it, expect } from 'vitest'
import {
  creativeCtrAlert, frequencyAlert, clickToCheckoutAlert, evaluateAlerts, type AdDayRow,
} from '../alerts'
import { creativeAlarmRows, CREATIVE_ALARM_NOTE } from '../adSpend'
import { buildReport, type ReportInput } from '../exportReport'

type Row = AdDayRow & { campaign_name: string }

const days = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']

// PP's top ad: healthy CTR (2 %) every day.
const pp = (extra: Partial<Row> = {}): Row[] => days.map(date => ({
  date, campaign_name: 'PP-22.06.2026', ad_name: 'PP-COLD', spend: 100,
  impressions: 10000, clicks: 300, link_clicks: 200, reach: null, initiate_checkout: null, ...extra,
}))

// A Cogni ad that outspends it and sits BELOW the 1.3 % floor for all 7 days,
// with reach that would trip the frequency alarm.
const cogni = (): Row[] => days.map(date => ({
  date, campaign_name: 'COGNI-TEST-09.11', ad_name: 'COGNI-03', spend: 400,
  impressions: 10000, clicks: 100, link_clicks: 80, reach: 2000, initiate_checkout: 1,
}))

describe('adding a Cogni campaign does not move a creative alarm', () => {
  it('CTR: result is identical with and without COGNI-TEST-09.11 rows', () => {
    const without = creativeCtrAlert(pp())
    const withC = creativeCtrAlert([...pp(), ...cogni()])
    expect(withC.severity).toBe(without.severity)
    expect(withC.message).toBe(without.message)
    expect(withC.values).toMatchObject({ ad: 'PP-COLD' })
    expect(withC.severity).toBe('none')
  })

  it('CTR: a Cogni top spender below the floor does not turn it red', () => {
    // Sanity — what the SAME rows would do if Cogni were read: red on COGNI-03.
    const cogniOnly = cogni().map(r => ({ ...r, campaign_name: 'PP-22.06.2026' }))
    expect(creativeCtrAlert(cogniOnly).severity).toBe('red')
    // …and as Cogni, it is not read.
    expect(creativeCtrAlert([...pp(), ...cogni()]).severity).toBe('none')
  })

  it('frequency: Cogni reach above 2.0 is not a finding', () => {
    expect(frequencyAlert(cogni().map(r => ({ ...r, campaign_name: 'PP-1' }))).severity).toBe('red')
    expect(frequencyAlert([...pp({ reach: 8000 }), ...cogni()]).severity).toBe('none')
  })

  it('click→checkout: Cogni rows are not read either', () => {
    const base = clickToCheckoutAlert(pp({ initiate_checkout: 100 }))
    const withC = clickToCheckoutAlert([...pp({ initiate_checkout: 100 }), ...cogni()])
    expect(withC.severity).toBe(base.severity)
    expect(withC.message).toBe(base.message)
  })

  it('evaluateAlerts: all three creative alarms are unchanged by Cogni rows', () => {
    const pick = (adDays: Row[]) => evaluateAlerts({ adDays }).all
      .filter(a => ['KREACJA_CTR', 'CZĘSTOTLIWOŚĆ', 'KLIK_DO_KASY'].includes(a.rule))
      .map(a => [a.rule, a.severity, a.message])
    expect(pick([...pp(), ...cogni()])).toEqual(pick(pp()))
  })
})

describe('which scopes are read', () => {
  it('reads memory and unknown; leaves out cogni and language, counting them', () => {
    const rows: Row[] = [
      ...pp(), ...cogni(),
      { date: days[0], campaign_name: '3T-TRIPWIRE', ad_name: '3T-1', spend: 50 },
      { date: days[0], campaign_name: 'Brand awareness', ad_name: 'x', spend: 10 },
    ]
    const { rows: read, leftOut } = creativeAlarmRows(rows)
    expect(leftOut).toEqual({ cogni: 7, language: 1 })
    expect(read).toHaveLength(7 + 1)
    expect(read.some(r => r.campaign_name === 'Brand awareness')).toBe(true)
  })

  it('reports what was left out on the alarm itself', () => {
    const a = creativeCtrAlert([...pp(), ...cogni()])
    expect(a.values?.leftOut).toEqual({ cogni: 7 })
  })

  it('a window with no Cogni carries no leftOut — nothing to say', () => {
    expect(creativeCtrAlert(pp()).values?.leftOut).toBeUndefined()
  })

  it('a window that is ALL Cogni says so instead of "no rows"', () => {
    const a = creativeCtrAlert(cogni())
    expect(a.severity).toBe('none')
    expect(a.message).toContain('poza progami')
    expect(a.message).toContain('cogni 7')
    expect(a.message).not.toContain('brak wierszy meta_ads_daily')
  })
})

describe('the report says which campaigns the creative alarms read', () => {
  const base = (adDays: Row[]): ReportInput => ({
    range: 'week', from: days[0], to: days[6], rangeSub: '', buildHash: 't', generatedAt: '2026-11-13T10:00:00Z',
    perf: null, prevPerf: null, dailyRows: [], profit: null, cpa: null, roas: null,
    campaignRows: [], campaignError: null, alerts: evaluateAlerts({ adDays }).all,
    goals: {
      pp: { pct: 0, status: 'neutral', note: '' }, revenue: { pct: 0, status: 'neutral', note: '' },
      cpa: { pct: 0, status: 'neutral', note: '' }, roas: { pct: 0, status: 'neutral', note: '' },
      ppOrders: null, ppTarget: 1, revenueTarget: 1,
    },
  } as ReportInput)

  it('always prints the note; adds the row count when Cogni was left out', () => {
    expect(CREATIVE_ALARM_NOTE).toBe('Alarmy kreacji: tylko kampanie z progami (Cogni poza progami)')
    const withC = buildReport(base([...pp(), ...cogni()]))
    expect(withC).toContain(`${CREATIVE_ALARM_NOTE} — pominięto wiersze: cogni 7`)
    const without = buildReport(base(pp()))
    expect(without).toContain(CREATIVE_ALARM_NOTE)
    expect(without).not.toContain('pominięto wiersze')
  })
})
