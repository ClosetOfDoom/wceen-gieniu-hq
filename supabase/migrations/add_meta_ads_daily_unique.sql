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
--
-- The predicate matches the index below: an EMPTY STRING is not an ad_id any
-- more than NULL is, and a row carrying one must not be judged against a rule
-- about ads.
-- ──────────────────────────────────────────────────────────
SELECT date, ad_id, count(*) AS copies
FROM meta_ads_daily
WHERE ad_id IS NOT NULL AND length(trim(ad_id)) > 0
GROUP BY date, ad_id
HAVING count(*) > 1
ORDER BY copies DESC, date DESC;

-- ──────────────────────────────────────────────────────────
-- STEP 2 — the constraint itself.
--
-- "One ad, one day, one row" is the rule. A row WITHOUT an ad_id is not an ad
-- and the rule does not apply to it: it is a CAMPAIGN-LEVEL aggregate, from
-- the period when the ingest pulled Meta at campaign granularity before moving
-- to ad granularity. Four such rows exist, on 2026-06-12 and 2026-06-13 — the
-- two earliest days in the table — two campaigns per day
-- (PP-PROSPECTING [30.07.2025] and PP-RETEST-KREATYWY [09.06]), different
-- amounts, empty ad_name. That spend is real and it stays.
--
-- Constraining them would be wrong in both directions: two campaigns on one
-- day share a NULL/empty ad_id, so a unique index over all rows would reject
-- the second one, and the rule it would be enforcing was never about them.
--
-- The predicate therefore excludes NULL *and* the empty string. NULLs never
-- conflict in Postgres anyway, but '' does — it is an ordinary value, so two
-- campaign rows on the same date would collide on (date, '') and the migration
-- would fail on data that is perfectly correct.
--
-- The ingest refuses to send rows with no ad_id (see upsertRows in
-- src/lib/meta/insights.ts), so nothing new lands outside this index.
-- ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_daily_date_ad_id_uniq
  ON meta_ads_daily (date, ad_id)
  WHERE ad_id IS NOT NULL AND length(trim(ad_id)) > 0;

-- ──────────────────────────────────────────────────────────
-- STEP 3 — verify it is there and usable as an ON CONFLICT target.
-- ──────────────────────────────────────────────────────────
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'meta_ads_daily';
