-- Migration: orders gains the Wix sales channel
-- Raised 2026-10-20, after Wix Pricing Plans turned out never to have been
-- connected to the sync at all.
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL.
--
-- WHY
-- ---------------------------------------------------------------------------
-- The Wix payments export carries a column "Rodzaj zamówienia". Over
-- 2026-06-11 → 2026-10-19 it holds two values: "eCom Platform" (1 605
-- payments) and "Pricing Plans" (32). The Make scenario is subscribed to eCom
-- orders only, so all 32 Pricing Plans payments — 1 526 PLN, including three
-- Perfect Student Online sales at 499 — are missing from `orders` entirely.
--
-- Once Make starts carrying that channel too, the two will be mixed in one
-- table with nothing to tell them apart. A 1 PLN "Jak się uczyć" plan payment
-- and a 119 PLN Pakiet Pamięciowy order would both just be rows.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD
-- ---------------------------------------------------------------------------
-- No billing_cycle, no frequency, no period, no subscription_status, no
-- instalment number. The export HAS those four columns and every one of them
-- is EMPTY on all 32 Pricing Plans rows — checked, not assumed. A column that
-- can only ever be NULL is not storage, it is a suggestion that data exists.
--
-- If Make's Pricing Plans module exposes any of them at the API level (it may;
-- the payments export is not the API), add them then, against rows that
-- actually carry values.
--
-- Nor is there a CHECK constraint on the allowed values. The export has shown
-- six different channels over its lifetime — eCom Platform, Pricing Plans,
-- Wix Form Builder, Wix Bookings, Wix Music, Pay Button — and a constraint
-- that rejects an unexpected one would make the sync drop that order. Losing
-- orders is the problem being fixed here, not a price worth paying for
-- tidiness.
--
-- Nor a DEFAULT. A default of 'eCom Platform' would quietly label every
-- Pricing Plans row as eCom the moment Make forgets to map the field. NULL
-- after this migration means "Make did not send it", which is a thing somebody
-- can see and fix.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_channel text;

COMMENT ON COLUMN public.orders.order_channel IS
  'Wix "Rodzaj zamówienia" — which part of Wix sold this. Known values: '
  '"eCom Platform", "Pricing Plans", "Wix Form Builder", "Wix Bookings", '
  '"Wix Music", "Pay Button". No CHECK constraint on purpose: an unexpected '
  'value must be stored, not rejected. NULL = the sync did not send it.';

-- Every row written before today came through the eCom-only Make scenario, so
-- every row written before today is an eCom order. That is not an assumption:
-- Pricing Plans was never connected, which is why all 32 of its payments are
-- absent from this table.
UPDATE public.orders
   SET order_channel = 'eCom Platform'
 WHERE order_channel IS NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT coalesce(order_channel, '(NULL)') AS kanal, count(*)
--   FROM public.orders GROUP BY 1 ORDER BY 2 DESC;
--
-- Zaraz po wklejeniu ma być jedna linia: "eCom Platform" ze wszystkimi
-- wierszami, zero NULL-i. "Pricing Plans" pojawi się dopiero, gdy
-- scenariusz Make zacznie ten kanał pobierać, albo po uruchomieniu
-- scripts/backfill-pricing-plans.mjs --apply.
--
-- Po podpięciu kanału w Make — wiersze bez kanału to dziura w mapowaniu:
-- SELECT count(*) FROM public.orders
--  WHERE order_channel IS NULL AND inserted_at > DATE '2026-10-20';
