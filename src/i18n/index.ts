// i18n entry point. Default language is English.
// Usage: import { t } from '../i18n'; t.kpi.wixOrders
import en, { type Strings } from './en'
import pl from './pl'

type SupportedLang = 'en' | 'pl'

const STRINGS: Record<SupportedLang, Strings> = { en, pl }

// Returns the full strings object for the given language, falling back to EN.
export function getStrings(lang: SupportedLang | string | null | undefined): Strings {
  if (lang === 'pl') return STRINGS.pl
  return STRINGS.en
}

// Default export: English strings (most UI code never needs to switch at runtime).
export const t: Strings = en

export type { Strings, SupportedLang }
export { en, pl }
