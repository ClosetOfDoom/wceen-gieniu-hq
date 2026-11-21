-- Migration: meta_ads_daily never loses Meta attribution on a later write
-- Raised 2026-11-21.
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL.
--
-- WHY
-- ---------------------------------------------------------------------------
-- Meta attributes purchases after the fact (7 days from the click), and Make
-- writes a snapshot of whatever Meta answers at that moment. The report
-- WCZORAJ for 19.11 (made 20.11 01:41) showed meta_purchases > 0 and a filled
-- raw_payload for 19.11; the report TYDZIEŃ 14–20.11 (made 21.11) shows Meta
-- purchases only on 20.11 and raw_payload on 1 of 7 days. Meta itself, asked
-- on 21.11 (level=ad, 7d_click/1d_view), still reports purchases on EVERY day
-- 14–20.11 (19.11: 9). So the rows lost values that the source still has: a
-- later upsert wrote 0 / NULL over them.
--
-- WHAT THIS DOES (and nothing else — no column is added, changed or dropped
-- on meta_ads_daily)
-- ---------------------------------------------------------------------------
-- A BEFORE UPDATE trigger on meta_ads_daily (an upsert's ON CONFLICT DO UPDATE
-- goes through it too):
--   · meta_purchases: a NULL, or a value LOWER than the stored one, is not
--     written — the stored value stays. A higher value goes through.
--   · raw_payload: an empty value (NULL, '', JSON null, {} or []) does not
--     replace a non-empty one. A non-empty new payload goes through.
--   · every refused write is logged to meta_ads_daily_guard_log (and RAISE
--     WARNING). Logging can never fail the write: a logging error becomes a
--     warning and the upsert carries on.
-- Every other column (spend, impressions, clicks, …) is written as before.
--
-- The column types of meta_ads_daily are not recorded in this repo (the table
-- was created outside it), so the function assumes none: meta_purchases is
-- compared as a number, raw_payload is judged empty through its text form,
-- which works for jsonb, json and text alike.
--
-- KNOWN LIMIT: Meta can, rarely, lower a count (a purchase de-duplicated or
-- re-attributed). Such a decrease is now refused and lands in the log, where
-- it can be checked by hand.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.meta_ads_daily_guard_log (
  id             bigserial   PRIMARY KEY,
  logged_at      timestamptz NOT NULL DEFAULT now(),
  row_date       text,
  campaign_id    text,
  adset_id       text,
  ad_id          text,
  column_name    text        NOT NULL,
  kept_value     text,
  refused_value  text,
  db_user        text        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE public.meta_ads_daily_guard_log IS
  'Writes to meta_ads_daily refused by meta_ads_daily_keep_attribution(): a NULL '
  'or lower meta_purchases, or an empty raw_payload over a non-empty one. '
  'raw_payload values are logged as their length, not their content.';

-- Service role only: RLS on, no policy, no grants for the API roles.
ALTER TABLE public.meta_ads_daily_guard_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ads_daily_guard_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.meta_ads_daily_keep_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER            -- the log insert must work whatever role Make writes with
SET search_path = public
AS $$
DECLARE
  old_payload_empty boolean;
  new_payload_empty boolean;
BEGIN
  -- meta_purchases: never NULL over a value, never lower than the stored value.
  IF OLD.meta_purchases IS NOT NULL
     AND (NEW.meta_purchases IS NULL OR NEW.meta_purchases < OLD.meta_purchases) THEN
    BEGIN
      INSERT INTO public.meta_ads_daily_guard_log
        (row_date, campaign_id, adset_id, ad_id, column_name, kept_value, refused_value)
      VALUES
        (OLD.date::text, OLD.campaign_id::text, OLD.adset_id::text, OLD.ad_id::text,
         'meta_purchases', OLD.meta_purchases::text, COALESCE(NEW.meta_purchases::text, 'NULL'));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'meta_ads_daily_keep_attribution: log insert failed: %', SQLERRM;
    END;
    RAISE WARNING 'meta_ads_daily %/%: meta_purchases % kept, % refused',
      OLD.date, OLD.ad_id, OLD.meta_purchases, COALESCE(NEW.meta_purchases::text, 'NULL');
    NEW.meta_purchases := OLD.meta_purchases;
  END IF;

  -- raw_payload: an empty value never replaces a non-empty one.
  old_payload_empty := OLD.raw_payload IS NULL
    OR btrim(OLD.raw_payload::text) IN ('', 'null', '{}', '[]');
  new_payload_empty := NEW.raw_payload IS NULL
    OR btrim(NEW.raw_payload::text) IN ('', 'null', '{}', '[]');
  IF NOT old_payload_empty AND new_payload_empty THEN
    BEGIN
      INSERT INTO public.meta_ads_daily_guard_log
        (row_date, campaign_id, adset_id, ad_id, column_name, kept_value, refused_value)
      VALUES
        (OLD.date::text, OLD.campaign_id::text, OLD.adset_id::text, OLD.ad_id::text,
         'raw_payload', 'length ' || length(OLD.raw_payload::text),
         COALESCE(NEW.raw_payload::text, 'NULL'));
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'meta_ads_daily_keep_attribution: log insert failed: %', SQLERRM;
    END;
    RAISE WARNING 'meta_ads_daily %/%: raw_payload kept, empty value refused', OLD.date, OLD.ad_id;
    NEW.raw_payload := OLD.raw_payload;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.meta_ads_daily_keep_attribution() IS
  'BEFORE UPDATE on meta_ads_daily: keeps a stored meta_purchases against a NULL '
  'or lower value and a non-empty raw_payload against an empty one; logs the '
  'refusal to meta_ads_daily_guard_log. See supabase/migrations/'
  '20261121_meta_ads_daily_keep_attribution.sql.';

DROP TRIGGER IF EXISTS meta_ads_daily_keep_attribution ON public.meta_ads_daily;
CREATE TRIGGER meta_ads_daily_keep_attribution
  BEFORE UPDATE ON public.meta_ads_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.meta_ads_daily_keep_attribution();

INSERT INTO public.applied_migrations (filename, note)
VALUES ('20261121_meta_ads_daily_keep_attribution.sql',
        'trigger: meta_purchases / raw_payload not overwritten by NULL, empty or lower')
ON CONFLICT (filename) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Trigger jest:
--    SELECT tgname, tgenabled FROM pg_trigger
--     WHERE tgrelid = 'public.meta_ads_daily'::regclass AND NOT tgisinternal;
-- 2. Test w transakcji z rollbackiem: supabase/tests/meta_ads_daily_keep_attribution.test.sql
--    (wklej całość; kończy się ROLLBACK, w bazie nic nie zostaje).
-- 3. Po kolejnym przebiegu Make — kto próbował nadpisać:
--    SELECT logged_at, row_date, ad_id, column_name, kept_value, refused_value, db_user
--      FROM public.meta_ads_daily_guard_log ORDER BY logged_at DESC LIMIT 50;
--
-- WARTOŚCI JUŻ SKASOWANE (14–19.11) TA MIGRACJA NIE PRZYWRACA. Wrócą dopiero,
-- gdy jakiś przebieg Make wyśle dla tych dób prawdziwe liczby z Meta (trigger
-- przepuszcza każdą wartość większą od zapisanej) — czyli po poprawce ścieżki
-- zamkniętej doby w Make (docs/make-meta-ingest.md, „Poprawka 2026-11-21”).
