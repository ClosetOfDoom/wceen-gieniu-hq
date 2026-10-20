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
-- Wix's own `Nr zamówienia` IS sequential. With that number stored, a missing
-- order becomes detectable from Supabase alone: a hole in the sequence is a
-- hole in the sync.
--
-- MEASURED, 2026-10-19. scripts/reconcile-wix-export.mjs compared the full Wix
-- payments export (17 304 rows) against every order in the table and settled
-- both the facts and the worth of the idea:
--
--   · The three rows lost on 2026-10-17 were 16033, 16034 and 16035 — NOT
--     16031-16035 as guessed here first. 16031 and 16032 did arrive.
--   · Run against the export as ground truth, the gap rule found 6 of 6 real
--     losses (recall 100%) and raised 21 flags in all (precision 28.6%). 13 of
--     the 15 false flags are order numbers with no payment row at all, i.e.
--     0 PLN orders — which Supabase DOES store, so once Make writes the number
--     those gaps close by themselves. 28.6% is the floor, not the estimate.
--   · The detector it replaces — assessSyncHealth, which flags a 15-minute
--     window holding more than one ARRIVED order — scored precision 0.9% over
--     the same period. It cannot do better: a row that never arrived leaves
--     nothing behind to count.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- REJESTRACJA — żeby panel MIGRACJE w Diagnostics przestał o tej zmianie krzyczeć
-- ─────────────────────────────────────────────────────────────────────────────
-- Odporne na brak rejestru: gdyby ktoś wgrał tę migrację przed
-- 20261020_applied_migrations.sql, zapis się pominie z komunikatem zamiast
-- wywrócić całą migrację na nieistniejącej tabeli.
DO $reg$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (filename)
      VALUES ('20261019_wix_order_number.sql')
      ON CONFLICT (filename) DO NOTHING;
  ELSE
    RAISE NOTICE 'applied_migrations nie istnieje — wgraj 20261020_applied_migrations.sql, zeby panel MIGRACJE zobaczyl te zmiane';
  END IF;
END
$reg$;
