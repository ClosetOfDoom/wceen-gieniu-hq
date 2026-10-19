-- Migration: orders gains the Wix order number
-- Raised 2026-10-19, after the sync was found to drop rows during a burst.
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL.
--
-- WHY
-- ---------------------------------------------------------------------------
-- On 2026-10-17 Wix recorded 23 realised payments and Supabase holds 20. The
-- three missing ones are known only because somebody compared a CSV export by
-- hand: `orders.external_order_id` is a UUID, so there is no sequence in the
-- table to find a gap in, and a row that never arrived leaves no trace at all.
--
-- Wix's own `Nr zamówienia` IS sequential — the lost rows were 16031-16035.
-- With that number stored, a missing order becomes detectable from Supabase
-- alone: a hole in the sequence is a hole in the sync.
--
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
-- Adding the column does not populate it. The Make scenario has to map Wix's
-- order number into it, and historical rows stay NULL — they are not
-- backfilled here, because inventing a number for a row whose number we do not
-- know would be worse than leaving it empty. Use
-- scripts/backfill-order-numbers.mjs with a Wix CSV export for that.
--
-- The gap detector stays OFF while coverage is zero and says so by name,
-- exactly like meta_ads_daily.reach does.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wix_order_number integer;

COMMENT ON COLUMN public.orders.wix_order_number IS
  'Wix "Nr zamówienia" — sequential, unlike external_order_id which is a UUID. '
  'A hole in this sequence means the sync dropped a row. NULL = not collected '
  'for that row (every row written before 2026-10-19).';

-- Unique where present, so a backfill or a double-write cannot create two rows
-- for one order. NULLs are exempt, which is what lets historical rows stay empty.
CREATE UNIQUE INDEX IF NOT EXISTS orders_wix_order_number_key
  ON public.orders (wix_order_number)
  WHERE wix_order_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS wierszy, count(wix_order_number) AS z_numerem
--   FROM public.orders;
--
-- Zaraz po wklejeniu z_numerem = 0 — to poprawne. Wypełni się dopiero, gdy
-- scenariusz Make zacznie mapować numer zamówienia.
--
-- Luki w numeracji, gdy kolumna już się zapełni:
--   WITH s AS (SELECT wix_order_number n,
--                     lead(wix_order_number) OVER (ORDER BY wix_order_number) nx
--                FROM public.orders WHERE wix_order_number IS NOT NULL)
--   SELECT n + 1 AS od, nx - 1 AS do, nx - n - 1 AS brakuje
--     FROM s WHERE nx - n > 1 ORDER BY n;
