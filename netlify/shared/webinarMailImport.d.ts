import type { SlotName, WebinarMailConfig } from './webinarMailConfig.js'

export function unwrapTrackingLink(href: string): string
export function unwrapAllLinks(html: string): string
export function stripWixInjection(html: string): string
export function replaceWebinarLinks(html: string, placeholder?: string): string
export function classifySlot(html: string, config?: WebinarMailConfig): SlotName | null
export function slugify(text: string, max?: number): string
export function setHeadFields(html: string, subject: string, preheader?: string): string
export function importTemplate(
  input: { html: string; subject: string; preheader?: string },
  config?: WebinarMailConfig,
): { slot: SlotName | null; html: string | null }
