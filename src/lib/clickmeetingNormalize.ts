// Defensive parser for ClickMeeting participant data arriving from Make.
// Some rows have a malformed email field where Make serialised the full
// registration object into the email column instead of just the email string.
// Example malformed value: {"email":"abc@gmail.com","registration_date":"2026-06-14T18:01:00"}

/** Collapse diacritics and lower-case a string for pattern matching. */
export function normalizeText(input: unknown): string {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** Extract a valid email address from a potentially malformed field value. */
export function extractEmail(value: unknown): string {
  if (!value) return ''
  const str = String(value).trim()
  if (/^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i.test(str)) return str
  const m = str.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)
  return m ? m[0] : ''
}

/** Extract a human-readable visitor name from a visitor_nickname or similar field. */
export function extractVisitorName(value: unknown): string {
  if (!value) return ''
  const str = String(value).trim()
  if (str.startsWith('{')) {
    const m = str.match(/"(?:name|nickname|visitor_nickname|first_name)"\s*:\s*"([^"]+)"/)
    if (m) return m[1]
    return ''
  }
  if (str.includes('@')) return ''
  return str.slice(0, 60)
}

/**
 * Extract registration date from a row.
 * Priority: explicit registered_at → registration_date → embedded in malformed email field → created_at.
 */
export function extractRegistrationDate(
  emailFieldRaw: string,
  registeredAt?: string | null,
  registrationDate?: string | null,
  createdAt?: string | null,
): string | null {
  if (registeredAt)     return registeredAt
  if (registrationDate) return registrationDate
  const m = emailFieldRaw.match(/"registration_date"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  if (createdAt) return createdAt
  return null
}

/** Derive a stable contact key for a participant row (email > visitor name > id). */
export function extractParticipantKey(row: Record<string, unknown>): string {
  const email = extractEmail(row.email)
  if (email) return email.toLowerCase()
  const name = extractVisitorName(row.visitor_nickname ?? row.name)
  if (name) return `name:${name.toLowerCase()}`
  return `id:${String(row.id ?? row.participant_id ?? Math.random()).slice(0, 16)}`
}

/** Mask an email address for display: ab***@domain.com */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email ? email.slice(0, 4) + '…' : '—'
  const [local, domain] = email.split('@')
  if (!local || !domain) return '—'
  return local.slice(0, 2) + '***@' + domain
}

export interface RawParticipantInput {
  email?: string | null
  registered_at?: string | null
  registration_date?: string | null
  created_at?: string | null
  [key: string]: unknown
}

/**
 * Normalise a raw participant row's email and registration date.
 * Safe to call even when email is already clean.
 */
export function normalizeParticipantFields(row: RawParticipantInput): {
  email: string
  registered_at: string | null
} {
  const rawEmail = String(row.email ?? '')
  const email = extractEmail(rawEmail) || rawEmail
  const registered_at = extractRegistrationDate(
    rawEmail,
    row.registered_at ?? undefined,
    row.registration_date ?? undefined,
    row.created_at ?? undefined,
  )
  return { email, registered_at }
}

/**
 * Fully normalize a raw participant row for display.
 * Returns email, displayLabel, contactKey, and registered_at.
 * Never shows raw JSON in UI.
 */
export function normalizeParticipantRow(row: RawParticipantInput & { id?: string; visitor_nickname?: string }): {
  email: string
  displayLabel: string
  contactKey: string
  registered_at: string | null
} {
  const { email, registered_at } = normalizeParticipantFields(row)
  const hasEmail = email.includes('@')

  const visitorName = extractVisitorName(row.visitor_nickname ?? row.email)
  const shortId = String(row.id ?? '').slice(0, 8)

  const displayLabel = hasEmail
    ? maskEmail(email)
    : visitorName || (shortId ? `participant-${shortId}` : '—')

  const contactKey = hasEmail
    ? email.toLowerCase()
    : visitorName ? `name:${visitorName.toLowerCase()}` : `id:${shortId}`

  return { email, displayLabel, contactKey, registered_at }
}
