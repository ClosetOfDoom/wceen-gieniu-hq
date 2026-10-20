-- Migration: orders gains the payment operator
-- Raised 2026-10-20, so the "administrative access grant" category can rest on
-- the condition it is supposed to rest on.
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL.
--
-- WHY
-- ---------------------------------------------------------------------------
-- A manual access grant — somebody paid outside the shop and was let into the
-- "Jak się uczyć" course by hand — is recorded by Wix as a 1 PLN order with
-- the payment operator "Offline". 34 of them happened between June and
-- October. They are not sales and must not touch revenue, margin, CPA or ROAS.
--
-- The rule that recognises them needs TWO conditions, because the amount on
-- its own would also swallow a genuine 1 PLN sale if one ever existed:
--
--     amount <= 5 PLN   AND   operator = Offline
--
-- `orders` has ten columns and not one of them is the operator. So the second
-- condition cannot be evaluated, and productCatalog.js currently falls back to
-- a narrower stand-in: the exact product name "Jak się uczyć". That stand-in
-- is documented where it lives (ADMIN_ACCESS in netlify/shared/
-- productCatalog.js) and it is strictly narrower than the amount alone — but
-- it is a stand-in, and this column is what retires it.
--
-- WHAT HAS TO HAPPEN AFTER THIS
-- ---------------------------------------------------------------------------
-- The column does not fill itself. Map Wix's "Operator płatności" into it in
-- the Make scenario. Until then every row stays NULL, which the classifier
-- reads as "unknown" — deliberately NOT as "not Offline", because guessing
-- that way round would turn every grant into an unexplained order.
--
-- Historical rows are NOT backfilled here. The operator for a row written
-- before today is knowable only from a Wix payments export, and inventing one
-- would be worse than leaving it empty.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text;

COMMENT ON COLUMN public.orders.payment_provider IS
  'Wix "Operator płatności". Known values: Stripe, PayPal, Przelewy24, '
  'Fondy Payments, SumUp, PayU, Offline. "Offline" + amount <= 5 PLN marks a '
  'manual access grant, not a sale — see ADMIN_ACCESS in productCatalog.js. '
  'No CHECK constraint on purpose: an unexpected operator must be stored, not '
  'rejected. NULL = the sync did not send it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT count(*) AS wierszy, count(payment_provider) AS z_operatorem
--   FROM public.orders;
--
-- Zaraz po wklejeniu z_operatorem = 0 — to poprawne. Wypełni się dopiero, gdy
-- scenariusz Make zacznie mapować operatora.
--
-- Po zmapowaniu — ile nadań dostępu i czy zgadzają się z eksportem Wix:
--   SELECT (order_created_at AT TIME ZONE 'Europe/Warsaw')::date AS doba,
--          count(*) AS nadan
--     FROM public.orders
--    WHERE payment_provider = 'Offline' AND amount <= 5
--    GROUP BY 1 ORDER BY 1;
