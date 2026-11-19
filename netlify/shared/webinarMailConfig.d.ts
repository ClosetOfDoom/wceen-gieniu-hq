export type SlotName = 'tuesday' | 'thursday'

export interface SlotConfig {
  readonly label: string
  readonly weekday: number
  readonly webinarTime: string
  readonly dir: string
  readonly variants: Readonly<Record<string, string>>
  readonly markers: readonly string[]
}

export interface WebinarMailConfig {
  readonly timezone: string
  readonly wakeHour: number
  readonly sendAtLocal: string
  readonly minLeadMinutes: number
  readonly lowQueueThreshold: number
  readonly skipDates: readonly string[]
  readonly placeholder: string
  readonly audience: { readonly labelIds: readonly string[]; readonly activeContactsOnly: boolean }
  readonly testRecipient: string
  readonly cron: string
  readonly slots: Readonly<Record<SlotName, SlotConfig>>
}

export const WEBINAR_MAIL_CONFIG: WebinarMailConfig
