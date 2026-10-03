-- Migration: meta_ads_daily gains reach and initiate_checkout
-- Raised and verified against the live Meta Insights API: 2026-10-03
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL.
--
-- WHY
-- ---------------------------------------------------------------------------
-- Two alarm rules cannot run without these columns, and both currently refuse
-- by name rather than quietly returning a green light:
--
--   CZĘSTOTLIWOŚĆ   frequency > 2.0   needs reach
--   KLIK_DO_KASY    click → checkout  needs initiate_checkout
--
-- Both values ALREADY ARRIVE in the existing Insights call. Confirmed on
-- 2026-10-03 against act_<redacted>, window 2026-09-26 … 2026-10-02, 14 ad-day
-- rows returned:
--
--   · `reach` is in INSIGHT_FIELDS (src/lib/meta/insights.ts) and came back
--     populated on 14 of 14 rows. It is parsed into MetaInsightRow and then
--     dropped, because there is nowhere to put it.
--   · `initiate_checkout` arrives inside `actions`, which is also already
--     requested. 203 checkouts over that window.
--
-- So this needs NO extra API call and NO extra Make operation. Nothing about
-- the request changes; only the write side gains two columns.
--
-- NULL IS NOT ZERO
-- ---------------------------------------------------------------------------
-- Historical rows stay NULL. They are not backfilled and not zeroed: Meta's
-- insights for a past window can be re-fetched, but writing 0 would state that
-- nobody was reached, which is false. Everything downstream reports NULL as
-- "BRAK DANYCH: meta_ads_daily.reach", never as 0 and never as a green status.
--
-- A NOTE ON WHAT initiate_checkout IS
-- ---------------------------------------------------------------------------
-- It is Meta's own count, pixel-attributed, with no UTM on the order side. It
-- under-reports, it cannot be joined to a Wix order, and it must never be used
-- as the denominator of a checkout conversion rate measured against Wix. It is
-- a TREND indicator within one funnel — the same standing rule as blended
-- CPA/ROAS.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.meta_ads_daily
  ADD COLUMN IF NOT EXISTS reach integer,
  ADD COLUMN IF NOT EXISTS initiate_checkout integer;

COMMENT ON COLUMN public.meta_ads_daily.reach IS
  'Meta reach for THIS ad on THIS day. NOT additive across days — summing daily '
  'reach does not give range reach. NULL = not collected for that row.';

COMMENT ON COLUMN public.meta_ads_daily.initiate_checkout IS
  'Meta action_type=initiate_checkout for this ad-day. Meta''s own pixel count: '
  'under-reported, no UTM, never joinable to a Wix order. Trend indicator within '
  'one funnel only — never attribution, never a conversion rate against Wix. '
  'NULL = not collected for that row.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU — pokrycie nowych kolumn
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT
--   count(*)                                   AS wierszy,
--   count(reach)                               AS z_reach,
--   count(initiate_checkout)                   AS z_checkout,
--   min(date) AS od, max(date) AS do
-- FROM public.meta_ads_daily;
--
-- Zaraz po wklejeniu: z_reach = 0 i z_checkout = 0 — to poprawne. Wypełnią się
-- dopiero przy najbliższym przebiegu ingestu, a alarmy 5 i 6 pozostają wyłączone
-- z jawnym "BRAK DANYCH", dopóki pokrycie jest zerowe.

-- ─────────────────────────────────────────────────────────────────────────────
-- CO SIĘ NIE ZMIENIA
-- ─────────────────────────────────────────────────────────────────────────────
-- Nie dotykamy meta_ads_daily.date — Meta raportuje w strefie konta reklamowego
-- i ta kolumna jest już płaską datą. Doba biznesowa Europe/Warsaw dotyczy
-- `orders`, nie tej tabeli (patrz 20260928_warsaw_business_day.sql).
