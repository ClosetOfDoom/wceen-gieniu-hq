// Defensive parser for ClickMeeting participant data arriving from Make.
// Some rows have a malformed email field where Make serialised the full
// registration object into the email column instead of just the email string.
// Example malformed value: {"email":"abc@gmail.com","registration_date":"2026-06-14T18:01:00"}

/** Extract a valid email address from a potentially malformed field value. */
export function extractEmail(value: unknown): string {
  if (!value) return ''
  const str = String(value).trim()
  // Happy path — already a plain email
  if (/^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$/i.test(str)) return str
  // Extract first email-like pattern from JSON / concatenated strings
  const m = str.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i)
  return m ? m[0] : str
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
  if (registeredAt)    return registeredAt
  if (registrationDate) return registrationDate
  // Try to pull it out of a JSON-like email field
  const m = emailFieldRaw.match(/"registration_date"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  if (createdAt) return createdAt
  return null
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
