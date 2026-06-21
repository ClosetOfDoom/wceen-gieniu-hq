// Shared DB row and API contract types for GIENIU HQ.
// These mirror the Supabase table schemas — update when schema changes.

export interface OrderRow {
  order_id?: string | number | null
  amount: number
  product_name_raw?: string | null
  payment_status?: string | null
  created_at?: string | null
  customer_email?: string | null
  customer_email_norm?: string | null
}

export interface MetaRow {
  campaign_name: string
  spend: number
  clicks: number
  impressions: number
  purchases: number
  date: string
  inserted_at?: string | null
}

export interface JsuFunnelRow {
  session_id?: string | null
  session_name?: string | null
  session_date?: string | null
  scheduled_at?: string | null
  registered_count?: number | null
  attendee_count?: number | null
  attendance_rate_pct?: number | null
  purchases?: number | null
  revenue?: number | null
  purchase_rate_pct?: number | null
  email_sent?: number | null
  email_delivered?: number | null
}

export interface LlmMeta {
  active: boolean
  provider: string | null
  used: boolean
  model: string | null
}

// Full response contract from /.netlify/functions/gieniu-command
export interface CommandResponse {
  answerText: string
  speechText: string
  intent: string
  confidence: number
  language: 'en' | 'pl' | 'mixed'
  dataSourcesUsed: string[]
  warnings: string[]
  llm: LlmMeta
}
