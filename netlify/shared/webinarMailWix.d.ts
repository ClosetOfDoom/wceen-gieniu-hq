import type { WixLike } from './webinarMail.js'

export function createWixClient(opts?: { apiKey?: string; siteId?: string; fetchImpl?: typeof fetch }): WixLike
export function checkUrl(url: string, fetchImpl?: typeof fetch): Promise<{ status: number; finalUrl: string }>
