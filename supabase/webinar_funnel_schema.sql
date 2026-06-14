-- ============================================================
-- WCEEN / GIENIU — Webinar Funnel Schema (additive only)
-- Run this ONCE in the Supabase SQL editor.
-- Does NOT touch existing tables (orders, meta_ads_daily,
-- automation_runs, v_daily_wix_meta_performance).
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- TABLES
-- ──────────────────────────────────────────────────────────

-- One row per email campaign blast (sent to a list segment).
-- Make scenario inserts rows here after each send.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name   text NOT NULL,
  subject         text,
  sent_at         timestamptz NOT NULL,
  product_tag     text NOT NULL,        -- 'JSU' | 'JZK' | 'PP' | 'WSZTP'
  list_segment    text,                 -- optional: 'buyers_PP' | 'all_active' etc.
  total_sent      int NOT NULL DEFAULT 0,
  total_delivered int NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

-- Granular per-recipient events for a campaign.
-- Make/webhook inserts one row per event from your ESP
-- (ActiveCampaign, MailerLite, etc.).
CREATE TABLE IF NOT EXISTS email_recipient_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES email_campaigns(id) ON DELETE CASCADE,
  email       text NOT NULL,
  event_type  text NOT NULL,   -- 'sent' | 'delivered' | 'open' | 'click' | 'bounce' | 'unsubscribe'
  occurred_at timestamptz NOT NULL,
  metadata    jsonb            -- url, ip, device, etc.
);

CREATE INDEX IF NOT EXISTS idx_ere_campaign_type
  ON email_recipient_events(campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_ere_email
  ON email_recipient_events(email);

-- One row per ClickMeeting webinar session instance
-- (recurring webinar = multiple rows, one per date).
CREATE TABLE IF NOT EXISTS webinar_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickmeeting_room_id text,             -- ClickMeeting numeric room/conference id
  session_name        text NOT NULL,     -- e.g. 'Jak się uczyć 2026-06-12'
  product_tag         text NOT NULL,     -- 'JSU' | 'JZK'
  scheduled_at        timestamptz NOT NULL,
  ended_at            timestamptz,
  registered_count    int NOT NULL DEFAULT 0,
  attendee_count      int NOT NULL DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  UNIQUE(clickmeeting_room_id, scheduled_at)
);

CREATE INDEX IF NOT EXISTS idx_ws_product_tag ON webinar_sessions(product_tag);
CREATE INDEX IF NOT EXISTS idx_ws_scheduled_at ON webinar_sessions(scheduled_at DESC);

-- Per-session participant record, one row per registered attendee.
-- Make upserts this after each session ends.
CREATE TABLE IF NOT EXISTS webinar_participants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid REFERENCES webinar_sessions(id) ON DELETE CASCADE,
  email               text NOT NULL,
  registered_at       timestamptz,
  attended            boolean NOT NULL DEFAULT false,
  attend_duration_min int,              -- minutes spent in the room
  purchased_at        timestamptz,      -- NULL if no purchase detected
  purchase_value      numeric(10,2),    -- 549.00 for 'Jak się uczyć'
  wix_order_id        text,             -- FK to orders table (loose reference)
  created_at          timestamptz DEFAULT now(),
  UNIQUE(session_id, email)
);

CREATE INDEX IF NOT EXISTS idx_wp_session ON webinar_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_wp_email   ON webinar_participants(email);
CREATE INDEX IF NOT EXISTS idx_wp_purchased ON webinar_participants(purchased_at)
  WHERE purchased_at IS NOT NULL;

-- ──────────────────────────────────────────────────────────
-- VIEWS
-- ──────────────────────────────────────────────────────────

-- Main funnel view: per JSU session with email context window.
-- Email stats are pulled from campaigns tagged 'JSU' whose
-- sent_at falls in the 3-day window before the session.
CREATE OR REPLACE VIEW v_webinar_jsu_funnel_by_session AS
SELECT
  ws.id                             AS session_id,
  ws.session_name,
  ws.scheduled_at::date             AS session_date,
  ws.scheduled_at,
  ws.registered_count,
  ws.attendee_count,
  CASE
    WHEN ws.registered_count > 0
    THEN ROUND(ws.attendee_count::numeric / ws.registered_count * 100, 1)
    ELSE NULL
  END                               AS attendance_rate_pct,
  COUNT(wp.id) FILTER (WHERE wp.purchased_at IS NOT NULL)
                                    AS purchases,
  COALESCE(SUM(wp.purchase_value) FILTER (WHERE wp.purchased_at IS NOT NULL), 0)
                                    AS revenue,
  CASE
    WHEN ws.attendee_count > 0
    THEN ROUND(
      COUNT(wp.id) FILTER (WHERE wp.purchased_at IS NOT NULL)::numeric
      / ws.attendee_count * 100, 1
    )
    ELSE NULL
  END                               AS purchase_rate_pct,

  -- Email campaign stats for JSU in a ±3 day window around the session
  COALESCE((
    SELECT SUM(ec.total_sent)
    FROM email_campaigns ec
    WHERE ec.product_tag = 'JSU'
      AND ec.sent_at BETWEEN ws.scheduled_at - INTERVAL '3 days'
                         AND ws.scheduled_at + INTERVAL '1 day'
  ), 0)                             AS email_sent,

  COALESCE((
    SELECT SUM(ec.total_delivered)
    FROM email_campaigns ec
    WHERE ec.product_tag = 'JSU'
      AND ec.sent_at BETWEEN ws.scheduled_at - INTERVAL '3 days'
                         AND ws.scheduled_at + INTERVAL '1 day'
  ), 0)                             AS email_delivered,

  COALESCE((
    SELECT COUNT(DISTINCT ere.email)
    FROM email_recipient_events ere
    JOIN email_campaigns ec ON ec.id = ere.campaign_id
    WHERE ec.product_tag = 'JSU'
      AND ere.event_type = 'open'
      AND ec.sent_at BETWEEN ws.scheduled_at - INTERVAL '3 days'
                         AND ws.scheduled_at + INTERVAL '1 day'
  ), 0)                             AS email_opens,

  COALESCE((
    SELECT COUNT(DISTINCT ere.email)
    FROM email_recipient_events ere
    JOIN email_campaigns ec ON ec.id = ere.campaign_id
    WHERE ec.product_tag = 'JSU'
      AND ere.event_type = 'click'
      AND ec.sent_at BETWEEN ws.scheduled_at - INTERVAL '3 days'
                         AND ws.scheduled_at + INTERVAL '1 day'
  ), 0)                             AS email_clicks

FROM webinar_sessions ws
LEFT JOIN webinar_participants wp ON wp.session_id = ws.id
WHERE ws.product_tag = 'JSU'
GROUP BY
  ws.id, ws.session_name, ws.scheduled_at, ws.registered_count, ws.attendee_count
ORDER BY ws.scheduled_at DESC;


-- Per-participant journey for all JSU sessions.
-- Useful for the "kto był i kupił" command and for drill-down by session_id.
CREATE OR REPLACE VIEW v_webinar_jsu_participant_journey AS
SELECT
  wp.id                  AS participant_id,
  wp.session_id,                         -- exposed so the service can filter by session
  wp.email,
  ws.scheduled_at::date  AS session_date,
  ws.session_name,
  wp.registered_at,
  wp.attended,
  wp.attend_duration_min,
  wp.purchased_at,
  wp.purchase_value,
  wp.wix_order_id
FROM webinar_participants wp
JOIN webinar_sessions ws ON ws.id = wp.session_id
WHERE ws.product_tag = 'JSU'
ORDER BY ws.scheduled_at DESC, wp.attended DESC, wp.purchased_at DESC NULLS LAST;


-- ──────────────────────────────────────────────────────────
-- HELPER: RLS (enable after verifying data flows correctly)
-- ──────────────────────────────────────────────────────────
-- ALTER TABLE email_campaigns          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE email_recipient_events   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webinar_sessions         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webinar_participants     ENABLE ROW LEVEL SECURITY;
-- The anon key used by the frontend only reads views — no write access needed.
-- Grant read on views:
-- GRANT SELECT ON v_webinar_jsu_funnel_by_session      TO anon;
-- GRANT SELECT ON v_webinar_jsu_participant_journey     TO anon;
