-- Migration: a register of which migrations have been applied
-- Raised 2026-10-20, because six migrations were waiting and the only place
-- that fact existed was a chat log.
--
-- WGRAJ TĘ JAKO PIERWSZĄ. Reszta migracji dopisuje się do tej tabeli, więc
-- dopóki jej nie ma, panel MIGRACJE pokaże wszystko jako niezastosowane.
--
-- WHY A REGISTER AT ALL
-- ---------------------------------------------------------------------------
-- Supabase does keep migration history, in supabase_migrations.schema_migrations
-- — and it is useless here for two reasons. PostgREST exposes only the `public`
-- schema, so the read channel this app uses cannot see it (checked: HTTP 404
-- on schema_migrations, supabase_migrations, applied_migrations and migrations).
-- And these migrations are pasted into the SQL editor by hand rather than run
-- through the CLI, so they would not be listed there even if it were readable.
--
-- So the register is explicit: each migration ends by writing its own filename
-- here, and the dashboard compares that against the files in the repo.
--
-- WHAT IS SEEDED, AND WHY SO LITTLE
-- ---------------------------------------------------------------------------
-- Only `add_meta_purchases_to_view.sql`, because it is the only pre-register
-- migration whose effect can be verified from outside: the view really does
-- expose `meta_purchases` (HTTP 200 on that column).
--
-- Deliberately NOT seeded, having been checked:
--   add_order_items_for_product_scoping.sql — `wix_order_items` returns 404,
--       so the table does not exist and the migration never ran
--   add_funding_checks.sql                  — `funding_checks` returns 404, same
--   add_meta_ads_daily_unique.sql           — creates an INDEX, which REST
--       cannot see either way. State genuinely unknown; left unregistered so
--       the panel says "unapplied" rather than inventing a yes.
--
-- A 404 from PostgREST means the table is not there. An RLS-blocked table
-- answers 200 with an empty array instead, so the two cannot be confused.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

COMMENT ON TABLE public.applied_migrations IS
  'Which files from supabase/migrations/ have been run. Written by the '
  'migrations themselves; read by the MIGRACJE panel in Diagnostics. A file '
  'in the repo with no row here is reported as unapplied.';

-- Read by the dashboard through the service key only (orders-data), so no
-- anon policy is needed. RLS on with no policy = closed to anon, which is
-- the same posture as `orders`.
ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.applied_migrations (filename, note) VALUES
  ('20261020_applied_migrations.sql', 'rejestr — ta migracja'),
  ('add_meta_purchases_to_view.sql',
   'zarejestrowana wstecz: widok faktycznie wystawia meta_purchases (sprawdzone 2026-10-20)')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT filename, applied_at, note FROM public.applied_migrations ORDER BY filename;
--
-- Mają być dwa wiersze. Panel MIGRACJE w Diagnostics pokaże resztę plików
-- jako NIEZASTOSOWANE — i to jest prawda, nie błąd panelu.
--
-- Jeśli wiesz, że któraś ze starszych migracji jednak była wgrana, zarejestruj
-- ją ręcznie, podając skąd ta pewność:
--   INSERT INTO public.applied_migrations (filename, note)
--   VALUES ('add_meta_ads_daily_unique.sql', 'potwierdzone ręcznie: indeks istnieje')
--   ON CONFLICT (filename) DO NOTHING;
