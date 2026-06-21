import { vi } from 'vitest'

export interface MockResponse {
  data: unknown
  ok?: boolean
  status?: number
}

export function mockFetch(data: unknown, ok = true, status = 200): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response)
}

export function mockFetchSequence(...responses: MockResponse[]): void {
  let i = 0
  global.fetch = vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)]
    i++
    return {
      ok:     r.ok     ?? true,
      status: r.status ?? 200,
      json:   async () => r.data,
      text:   async () => JSON.stringify(r.data),
    } as unknown as Response
  })
}

export function mockFetchError(message = 'Network error'): void {
  global.fetch = vi.fn().mockRejectedValue(new Error(message))
}

export function restoreFetch(): void {
  vi.restoreAllMocks()
}
