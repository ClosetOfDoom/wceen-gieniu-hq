-- ============================================================
-- meta_ads_daily — UNIQUE key for idempotent upsert on (date, ad_id).
--
-- Needed so the repo ingest and the Make scenarios can both write the same day
-- without duplicating rows: the second writer updates the first writer's row
-- instead of inserting a new one.
--
-- RUN THIS BEFORE the first ingest. Without it PostgREST rejects the upsert with
-- 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
-- specification") — loudly, which is the intended failure mode.
--
-- Run ONCE in the Supabase SQL editor. Additive: no column is added or dropped.
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- STEP 1 — look before you constrain.
-- Creating the index fails if duplicates already exist. Run this first; it must
-- return zero rows. If it does not, decide which copy to keep before step 2.
-- ──────────────────────────────────────────────────────────
SELECT date, ad_id, count(*) AS copies
FROM meta_ads_daily
WHERE ad_id IS NOT NULL
GROUP BY date, ad_id
HAVING count(*) > 1
ORDER BY copies DESC, date DESC;

-- ──────────────────────────────────────────────────────────
-- STEP 2 — the constraint itself.
-- Partial index: rows with a NULL ad_id are excluded, because NULLs never
-- conflict in Postgres and such rows cannot take part in the upsert key anyway.
-- The ingest refuses to send them (see upsertRows in src/lib/meta/insights.ts).
-- ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_daily_date_ad_id_uniq
  ON meta_ads_daily (date, ad_id)
  WHERE ad_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────
-- STEP 3 — verify it is there and usable as an ON CONFLICT target.
-- ──────────────────────────────────────────────────────────
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'meta_ads_daily';
