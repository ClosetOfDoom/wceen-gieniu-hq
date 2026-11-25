// The browser side of the English brief: a brief saved today without lang "en" is rewritten once; one load at a time;
// the automatic playback never speaks a Polish brief.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../stanleyAuth', () => ({ stanleyFetch: vi.fn() }))

import { stanleyFetch } from '../stanleyAuth'
import { fetchLatestBrief, needsEnglishRewrite, warsawToday, type DailyBrief } from '../../services/stanleyBrief'

const fetchMock = stanleyFetch as unknown as ReturnType<typeof vi.fn>
const brief = (over: Partial<DailyBrief> = {}): DailyBrief => ({
  date: warsawToday(), createdAt: '', title: 't', intro: null, sections: [], text: '', speech: 'Brief for today.', alerts: [], gaps: [],
  llm: { used: false, provider: null, model: null, checked: 0, removed: 0, error: null }, ...over,
})
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })

beforeEach(() => fetchMock.mockReset())

describe('needsEnglishRewrite', () => {
  it('only today\'s brief without lang en', () => {
    const today = '2026-11-25'
    expect(needsEnglishRewrite({ date: today }, today)).toBe(true)
    expect(needsEnglishRewrite({ date: today, lang: 'en' }, today)).toBe(false)
    expect(needsEnglishRewrite({ date: '2026-11-24' }, today)).toBe(false)   // history is left alone
    expect(needsEnglishRewrite(null, today)).toBe(false)
  })
})

describe('fetchLatestBrief', () => {
  it('a Polish brief from today is written again on the spot and the English one is returned', async () => {
    const polish = brief()
    const english = brief({ lang: 'en', speech: 'Brief for today, sir.' })
    fetchMock.mockResolvedValueOnce(ok(polish)).mockResolvedValueOnce(ok(english))
    const b = await fetchLatestBrief()
    expect(b?.lang).toBe('en')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const post = fetchMock.mock.calls[1] as [string, { method: string; body: string }]
    expect(post[1].method).toBe('POST'); expect(JSON.parse(post[1].body)).toEqual({ action: 'regenerate' })
  })
  it('an English brief is returned as it is, with one request', async () => {
    fetchMock.mockResolvedValueOnce(ok(brief({ lang: 'en' })))
    expect((await fetchLatestBrief())?.lang).toBe('en')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('if the rewrite fails the saved brief is returned (its lang tells the player not to speak it on its own)', async () => {
    fetchMock.mockResolvedValueOnce(ok(brief())).mockResolvedValueOnce(new Response('{}', { status: 500 }))
    const b = await fetchLatestBrief()
    expect(b?.lang).toBeUndefined(); expect(b?.speech).toBe('Brief for today.')
  })
  it('no brief yet → null', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await fetchLatestBrief()).toBeNull()
  })
  it('two callers at once share one load (the card and the playback must not rewrite twice)', async () => {
    fetchMock.mockResolvedValueOnce(ok(brief({ lang: 'en' })))
    const [a, b] = await Promise.all([fetchLatestBrief(), fetchLatestBrief()])
    expect(a).toBe(b); expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
