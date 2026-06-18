import { supabase } from '../services/supabase'
import { normalizeParticipantFields } from './clickmeetingNormalize'
import { normalizeProduct, type ProductTag, type ProductClassification } from './webinarProduct'

export interface RawSession {
  id: string
  session_name: string
  product_tag: string | null
  scheduled_at: string
  ended_at: string | null
  registered_count: number
  attendee_count: number
  product: ProductClassification
}

export interface RawParticipant {
  id: string
  session_id: string
  email: string
  displayLabel: string    // masked email, visitor name, or "participant-<short-id>"
  registered_at: string | null
  attended: boolean
  attendStatus: 'yes' | 'no' | 'not_populated'
  attend_duration_min: number | null
  purchased_at: string | null
  purchase_value: number | null
  wix_order_id: string | null
  purchaseStatus: 'bought' | 'not_mapped'
  contactKey: string      // unique identifier for deduplication
}

export interface WebinarRawData {
  sessions: RawSession[]
  participants: RawParticipant[]
  uniqueContacts: number
  attendancePopulated: boolean
  purchasesMapped: boolean
  viewParticipantCount: number
  hasMismatch: boolean
  source: 'raw_tables'
  latestSessionDate: string | null
  latestSessionName: string | null
}

export async function fetchWebinarRawData(): Promise<WebinarRawData> {
  // Always query raw tables first — views are unreliable when registered_count=0
  const [sessResult, partResult] = await Promise.all([
    supabase
      .from('webinar_sessions')
      .select('id, session_name, product_tag, scheduled_at, ended_at, registered_count, attendee_count')
      .order('scheduled_at', { ascending: false })
      .limit(50),
    supabase
      .from('webinar_participants')
      .select('id, session_id, email, registered_at, registration_date, attended, attend_duration_min, purchased_at, purchase_value, wix_order_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  if (sessResult.error) console.warn('webinar_sessions fetch error:', sessResult.error.message)
  if (partResult.error) console.warn('webinar_participants fetch error:', partResult.error.message)

  const rawSessions = (sessResult.data ?? []) as Record<string, unknown>[]
  const rawParts    = (partResult.data ?? []) as Record<string, unknown>[]

  // Normalize and classify sessions
  const sessions: RawSession[] = rawSessions.map(s => ({
    id:               String(s.id ?? ''),
    session_name:     String(s.session_name ?? s.id ?? ''),
    product_tag:      (s.product_tag as string | null) ?? null,
    scheduled_at:     String(s.scheduled_at ?? ''),
    ended_at:         (s.ended_at as string | null) ?? null,
    registered_count: Number(s.registered_count ?? 0),
    attendee_count:   Number(s.attendee_count ?? 0),
    product:          normalizeProduct({ product_tag: s.product_tag as string | null, session_name: s.session_name as string | null }),
  }))

  // Normalize participant rows
  const participants: RawParticipant[] = rawParts.map(r => {
    const { email, registered_at } = normalizeParticipantFields({
      email:             r.email as string | null,
      registered_at:     r.registered_at as string | null,
      registration_date: r.registration_date as string | null,
      created_at:        r.created_at as string | null,
    })

    const id      = String(r.id ?? '')
    const hasEmail = email.includes('@')

    const displayLabel = hasEmail
      ? maskEmail(email)
      : String(r.email ?? '').trim().slice(0, 30) || `participant-${id.slice(0, 8)}`

    const contactKey = hasEmail ? email.toLowerCase() : `id:${id}`

    const attended    = r.attended as boolean | null
    const attendStatus: RawParticipant['attendStatus'] =
      attended === true  ? 'yes' :
      attended === false ? 'no'  : 'not_populated'

    const hasPurchase = !!(r.purchased_at || (r.purchase_value as number | null ?? 0) > 0 || r.wix_order_id)

    return {
      id,
      session_id:          String(r.session_id ?? ''),
      email,
      displayLabel,
      registered_at,
      attended:            attended ?? false,
      attendStatus,
      attend_duration_min: (r.attend_duration_min as number | null) ?? null,
      purchased_at:        (r.purchased_at as string | null) ?? null,
      purchase_value:      (r.purchase_value as number | null) ?? null,
      wix_order_id:        (r.wix_order_id as string | null) ?? null,
      purchaseStatus:      hasPurchase ? 'bought' : 'not_mapped',
      contactKey,
    }
  })

  // Unique contacts
  const contactSet = new Set(participants.map(p => p.contactKey))

  // Attendance populated = at least one row has attended=true
  const attendancePopulated = participants.some(p => p.attended === true)
    || sessions.some(s => s.attendee_count > 0)

  // Purchases mapped = at least one participant has a purchase
  const purchasesMapped = participants.some(p => p.purchaseStatus === 'bought')

  // Check view mismatch: fetch view participant count to compare
  let viewParticipantCount = 0
  try {
    const { count } = await supabase
      .from('v_webinar_jsu_funnel_by_session')
      .select('registered_count', { count: 'exact', head: false })
      .limit(1)
    viewParticipantCount = count ?? 0
  } catch { /* non-fatal */ }

  const hasMismatch = viewParticipantCount === 0 && participants.length > 0

  console.log('GIENIU webinarRawData', {
    sessions: sessions.length,
    participants: participants.length,
    uniqueContacts: contactSet.size,
    attendancePopulated,
    purchasesMapped,
    viewParticipantCount,
    hasMismatch,
  })

  return {
    sessions,
    participants,
    uniqueContacts:       contactSet.size,
    attendancePopulated,
    purchasesMapped,
    viewParticipantCount,
    hasMismatch,
    source: 'raw_tables',
    latestSessionDate:    sessions[0]?.scheduled_at?.slice(0, 10) ?? null,
    latestSessionName:    sessions[0]?.session_name ?? null,
  }
}

/** Get participants for a specific product tag. */
export function filterByProduct(data: WebinarRawData, tag: ProductTag | 'ALL'): {
  sessions: RawSession[]
  participants: RawParticipant[]
} {
  if (tag === 'ALL') return { sessions: data.sessions, participants: data.participants }
  const sessionIds = new Set(data.sessions.filter(s => s.product.canonicalTag === tag).map(s => s.id))
  return {
    sessions:     data.sessions.filter(s => s.product.canonicalTag === tag),
    participants: data.participants.filter(p => sessionIds.has(p.session_id)),
  }
}

function maskEmail(email: string): string {
  if (!email.includes('@')) return email.slice(0, 4) + '…'
  const [local, domain] = email.split('@')
  return (local ?? '').slice(0, 2) + '***@' + (domain ?? '')
}
