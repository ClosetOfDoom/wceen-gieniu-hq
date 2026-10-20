-- ═══════════════════════════════════════════════════════════════════════════
-- WSZYSTKIE ZALEGŁE MIGRACJE — JEDEN WKLEJ
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WYGENEROWANE przez scripts/gen-paste-bundles.mjs z plików w
-- supabase/migrations/. Nie edytuj tego pliku ręcznie — zmień migrację
-- i uruchom `npm run gen:paste`. `npm run verify` pilnuje, żeby się nie
-- rozjechało.
--
-- JAK TEGO UŻYĆ
-- ---------------------------------------------------------------------------
--   1. Wklej CAŁOŚĆ do SQL Editora w Supabase i uruchom.
--   2. Przeczytaj wynik ostatniego SELECT-a: ma wypisać 10 wierszy
--      w applied_migrations.
--   3. Dopiero potem wklej supabase/_PASTE_2_dedup.sql — osobno, bo tamten
--      kasuje dane i ma się rozbić przy niezgodności.
--
-- CAŁOŚĆ JEST W JEDNEJ TRANSAKCJI. Jeśli cokolwiek pójdzie nie tak, baza
-- wraca do stanu sprzed wklejenia — nie ma stanu połowicznego.
--
-- NIE MA TU ŻADNEGO DELETE. Jedyny UPDATE to wypełnienie świeżo utworzonej
-- kolumny orders.order_channel wartością 'eCom Platform' tam, gdzie jest
-- NULL — a przed tym UPDATE jest ona NULL w każdym wierszu, bo powstaje
-- w tej samej transakcji. Nic istniejącego nie jest nadpisywane.
--
-- WKLEJENIE DWA RAZY NIC NIE PSUJE. Wszystko jest IF NOT EXISTS,
-- CREATE OR REPLACE, DROP ... IF EXISTS albo ON CONFLICT DO NOTHING.
--
-- POMINIĘTE, BO JUŻ ZASTOSOWANE
-- ---------------------------------------------------------------------------
--   add_meta_purchases_to_view.sql
--       widok faktycznie wystawia meta_purchases (HTTP 200) — zastosowana 2026-06-23
--       Nie wklejamy jej, ale dopisujemy do rejestru, żeby panel przestał ją zgłaszać.
--
-- POPRAWKI MECHANICZNE WPROWADZONE PRZY SKŁADANIU
-- ---------------------------------------------------------------------------
--   · 20261020_applied_migrations.sql: usunięte własne BEGIN;/COMMIT; — w
--     pakiecie jest jedna wspólna transakcja, a zagnieżdżony COMMIT
--     zamknąłby ją w połowie
--   · add_order_items_for_product_scoping.sql: dodane DROP POLICY IF EXISTS
--     przed CREATE POLICY "anon read" — jedyna instrukcja w całym zestawie,
--     która przy drugim wklejeniu rzuciłaby błąd 42710 (polityka już
--     istnieje)
--   · add_order_items_for_product_scoping.sql: dopisana rejestracja w
--     applied_migrations — plik powstał przed rejestrem, więc sam się nie
--     zgłasza i panel pokazywałby go jako niezastosowany
--   · add_funding_checks.sql: dopisana rejestracja w applied_migrations —
--     plik powstał przed rejestrem, więc sam się nie zgłasza i panel
--     pokazywałby go jako niezastosowany
--   · add_meta_ads_daily_unique.sql: dopisana rejestracja w
--     applied_migrations — plik powstał przed rejestrem, więc sam się nie
--     zgłasza i panel pokazywałby go jako niezastosowany
--   · 20261020_order_channel.sql: usunięte własne BEGIN;/COMMIT; — w
--     pakiecie jest jedna wspólna transakcja, a zagnieżdżony COMMIT
--     zamknąłby ją w połowie
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════
-- 20261020_applied_migrations.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      Rejestr migracji — tabela applied_migrations, którą czyta panel MIGRACJE.
-- CZEGO OCZEKIWAĆ: Musi być pierwsza: każda kolejna sekcja dopisuje się do tej tabeli.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.applied_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  note        text
);

COMMENT ON TABLE public.applied_migrations IS
  'Which files from supabase/migrations/ have been run. Written by the '
  'migrations themselves; read by the MIGRACJE panel in Diagnostics. A file '
  'in the repo with no row here is reported as unapplied.';

ALTER TABLE public.applied_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.applied_migrations (filename, note) VALUES
  ('20261020_applied_migrations.sql', 'rejestr — ta migracja'),
  ('add_meta_purchases_to_view.sql',
   'zarejestrowana wstecz: widok faktycznie wystawia meta_purchases (sprawdzone 2026-10-20)')
ON CONFLICT (filename) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════
-- add_order_items_for_product_scoping.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      Tabela wix_order_items (pozycje zamówień) + indeksy + RLS.
-- CZEGO OCZEKIWAĆ: Sprawdzone 2026-10-20: tabela nie istnieje (HTTP 404), więc migracja
--                  nigdy nie poszła.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.wix_order_items (
  id              text          PRIMARY KEY,
  order_id        text          NOT NULL,
  order_date      date          NOT NULL,
  product_name    text,
  product_sku     text,
  quantity        integer       NOT NULL DEFAULT 1,
  line_total      numeric(10,2),
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wix_order_items_order_date_idx ON public.wix_order_items (order_date);
CREATE INDEX IF NOT EXISTS wix_order_items_product_sku_idx ON public.wix_order_items (product_sku);
CREATE INDEX IF NOT EXISTS wix_order_items_order_id_idx   ON public.wix_order_items (order_id);

ALTER TABLE public.wix_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read" ON public.wix_order_items;
CREATE POLICY "anon read" ON public.wix_order_items
  FOR SELECT USING (true);

INSERT INTO public.applied_migrations (filename)
  VALUES ('add_order_items_for_product_scoping.sql')
  ON CONFLICT (filename) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════
-- add_funding_checks.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      Tabela funding_checks (terminy sprawdzania dotacji) + trigger + polityka RLS.
-- CZEGO OCZEKIWAĆ: Sprawdzone 2026-10-20: tabela nie istnieje (HTTP 404).
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funding_checks (
  funding_id  text PRIMARY KEY,
  check_by    date,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION funding_checks_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_funding_checks_touch ON funding_checks;
CREATE TRIGGER trg_funding_checks_touch
  BEFORE UPDATE ON funding_checks
  FOR EACH ROW EXECUTE FUNCTION funding_checks_touch();

ALTER TABLE funding_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funding_checks_anon_rw ON funding_checks;
CREATE POLICY funding_checks_anon_rw ON funding_checks
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON funding_checks TO anon, authenticated;

INSERT INTO public.applied_migrations (filename)
  VALUES ('add_funding_checks.sql')
  ON CONFLICT (filename) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════
-- add_meta_ads_daily_unique.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      Unikalny indeks na meta_ads_daily (date, ad_id) — blokuje podwójny ingest.
-- CZEGO OCZEKIWAĆ: Stanu nie da się sprawdzić przez REST (indeksy są niewidoczne). CREATE
--                  UNIQUE INDEX IF NOT EXISTS, więc wklejenie jest bezpieczne w obie
--                  strony. UWAGA: jeśli w tabeli SĄ duplikaty, ta instrukcja się wywali i
--                  cofnie CAŁĄ transakcję — pierwszy SELECT w tej sekcji je pokaże.
-- ──────────────────────────────────────────────────────────────────────────

SELECT date, ad_id, count(*) AS copies
FROM meta_ads_daily
WHERE ad_id IS NOT NULL
GROUP BY date, ad_id
HAVING count(*) > 1
ORDER BY copies DESC, date DESC;

CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_daily_date_ad_id_uniq
  ON meta_ads_daily (date, ad_id)
  WHERE ad_id IS NOT NULL;

SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'meta_ads_daily';

INSERT INTO public.applied_migrations (filename)
  VALUES ('add_meta_ads_daily_unique.sql')
  ON CONFLICT (filename) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════
-- 20261019_wix_order_number.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      orders.wix_order_number — numer zamówienia Wix, do wykrywania luk w numeracji.
-- CZEGO OCZEKIWAĆ: Kolumna nie istnieje (HTTP 400). Po wgraniu będzie pusta — wypełni ją
--                  Make.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wix_order_number integer;

COMMENT ON COLUMN public.orders.wix_order_number IS
  'Wix "Nr zamówienia" — sequential, unlike external_order_id which is a UUID. '
  'A hole in this sequence means the sync dropped a row. NULL = not collected '
  'for that row (every row written before 2026-10-19).';

CREATE UNIQUE INDEX IF NOT EXISTS orders_wix_order_number_key
  ON public.orders (wix_order_number)
  WHERE wix_order_number IS NOT NULL;

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


-- ══════════════════════════════════════════════════════════════════════════
-- 20261020_order_channel.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      orders.order_channel — eCom Platform vs Pricing Plans.
-- CZEGO OCZEKIWAĆ: Kolumna nie istnieje (HTTP 400). Zawiera UPDATE, który wpisuje "eCom
--                  Platform" w świeżo utworzoną kolumnę tam, gdzie jest NULL. Nic nie
--                  nadpisuje — kolumna powstaje w tej samej transakcji i przed UPDATE
--                  jest pusta w każdym wierszu.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_channel text;

COMMENT ON COLUMN public.orders.order_channel IS
  'Wix "Rodzaj zamówienia" — which part of Wix sold this. Known values: '
  '"eCom Platform", "Pricing Plans", "Wix Form Builder", "Wix Bookings", '
  '"Wix Music", "Pay Button". No CHECK constraint on purpose: an unexpected '
  'value must be stored, not rejected. NULL = the sync did not send it.';

UPDATE public.orders
   SET order_channel = 'eCom Platform'
 WHERE order_channel IS NULL;

DO $reg$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (filename)
      VALUES ('20261020_order_channel.sql')
      ON CONFLICT (filename) DO NOTHING;
  ELSE
    RAISE NOTICE 'applied_migrations nie istnieje — wgraj 20261020_applied_migrations.sql, zeby panel MIGRACJE zobaczyl te zmiane';
  END IF;
END
$reg$;


-- ══════════════════════════════════════════════════════════════════════════
-- 20261020_payment_provider.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      orders.payment_provider — operator płatności Wix.
-- CZEGO OCZEKIWAĆ: Kolumna nie istnieje (HTTP 400). Po wgraniu pusta — wypełni ją Make.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_provider text;

COMMENT ON COLUMN public.orders.payment_provider IS
  'Wix "Operator płatności". Known values: Stripe, PayPal, Przelewy24, '
  'Fondy Payments, SumUp, PayU, Offline. "Offline" + amount <= 5 PLN marks a '
  'manual access grant, not a sale — see ADMIN_ACCESS in productCatalog.js. '
  'No CHECK constraint on purpose: an unexpected operator must be stored, not '
  'rejected. NULL = the sync did not send it.';

DO $reg$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (filename)
      VALUES ('20261020_payment_provider.sql')
      ON CONFLICT (filename) DO NOTHING;
  ELSE
    RAISE NOTICE 'applied_migrations nie istnieje — wgraj 20261020_applied_migrations.sql, zeby panel MIGRACJE zobaczyl te zmiane';
  END IF;
END
$reg$;


-- ══════════════════════════════════════════════════════════════════════════
-- 20260928_warsaw_business_day.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      Przebudowa widoku v_daily_wix_meta_performance na dobę Europe/Warsaw.
-- CZEGO OCZEKIWAĆ: Sprawdzone 2026-10-20: widok liczy 86 zamówień za 09-15.10 przy 87 w
--                  dobie warszawskiej i 2 zamówieniach granicznych — czyli nadal tnie po
--                  UTC. Definicja zachowuje meta_purchases i meta_purchase_value
--                  (zdiffowane).
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_daily_wix_meta_performance AS
 WITH meta AS (
         SELECT meta_ads_daily.date,
            count(*) AS ads_count,
            sum(meta_ads_daily.spend) AS meta_spend,
            sum(meta_ads_daily.impressions) AS impressions,
            sum(meta_ads_daily.clicks) AS clicks,
            sum(meta_ads_daily.link_clicks) AS link_clicks,
            sum(meta_ads_daily.meta_purchases) AS meta_purchases,
            sum(meta_ads_daily.meta_purchase_value) AS meta_purchase_value
           FROM meta_ads_daily
          GROUP BY meta_ads_daily.date
        ), wix AS (
         SELECT (orders.order_created_at AT TIME ZONE 'Europe/Warsaw')::date AS date,
            count(*) AS wix_orders,
            sum(orders.amount) AS wix_revenue
           FROM orders
          WHERE orders.source = 'wix'::text AND lower(orders.payment_status) = 'paid'::text AND orders.external_order_id !~~* 'TEST-%'::text AND orders.email !~~* '%test%'::citext
          GROUP BY ((orders.order_created_at AT TIME ZONE 'Europe/Warsaw')::date)
        )
 SELECT COALESCE(meta.date, wix.date) AS date,
    COALESCE(meta.meta_spend, 0::numeric) AS meta_spend,
    COALESCE(wix.wix_orders, 0::bigint) AS wix_orders,
    COALESCE(wix.wix_revenue, 0::numeric) AS wix_revenue,
        CASE
            WHEN COALESCE(wix.wix_orders, 0::bigint) > 0 THEN round(COALESCE(meta.meta_spend, 0::numeric) / wix.wix_orders::numeric, 2)
            ELSE NULL::numeric
        END AS real_cpa,
        CASE
            WHEN COALESCE(meta.meta_spend, 0::numeric) > 0::numeric THEN round(COALESCE(wix.wix_revenue, 0::numeric) / meta.meta_spend, 2)
            ELSE 0::numeric
        END AS real_roas,
    COALESCE(meta.impressions, 0::bigint) AS impressions,
    COALESCE(meta.clicks, 0::bigint) AS clicks,
    COALESCE(meta.link_clicks, 0::bigint) AS link_clicks,
    COALESCE(meta.ads_count, 0::bigint) AS ads_count,
    COALESCE(meta.meta_purchases, 0::numeric) AS meta_purchases,
    COALESCE(meta.meta_purchase_value, 0::numeric) AS meta_purchase_value
   FROM meta
     FULL JOIN wix USING (date)
  ORDER BY (COALESCE(meta.date, wix.date)) DESC;

DO $reg$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (filename)
      VALUES ('20260928_warsaw_business_day.sql')
      ON CONFLICT (filename) DO NOTHING;
  ELSE
    RAISE NOTICE 'applied_migrations nie istnieje — wgraj 20261020_applied_migrations.sql, zeby panel MIGRACJE zobaczyl te zmiane';
  END IF;
END
$reg$;


-- ══════════════════════════════════════════════════════════════════════════
-- 20261003_meta_reach_initiate_checkout.sql
-- ══════════════════════════════════════════════════════════════════════════
-- CO ROBI:      meta_ads_daily.reach + initiate_checkout.
-- CZEGO OCZEKIWAĆ: Obie kolumny nie istnieją (HTTP 400). Po wgraniu puste — wypełni je
--                  ingest Meta.
-- ──────────────────────────────────────────────────────────────────────────

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

DO $reg$
BEGIN
  IF to_regclass('public.applied_migrations') IS NOT NULL THEN
    INSERT INTO public.applied_migrations (filename)
      VALUES ('20261003_meta_reach_initiate_checkout.sql')
      ON CONFLICT (filename) DO NOTHING;
  ELSE
    RAISE NOTICE 'applied_migrations nie istnieje — wgraj 20261020_applied_migrations.sql, zeby panel MIGRACJE zobaczyl te zmiane';
  END IF;
END
$reg$;


-- ══════════════════════════════════════════════════════════════════════════
-- REJESTRACJA MIGRACJI JUŻ ZASTOSOWANYCH
-- ══════════════════════════════════════════════════════════════════════════
-- Nie wklejamy ich SQL-a, ale panel MIGRACJE porównuje katalog repo
-- z tą tabelą, więc bez wpisu zgłaszałby je jako brakujące.

INSERT INTO public.applied_migrations (filename, note) VALUES
  ('add_meta_purchases_to_view.sql', 'widok faktycznie wystawia meta_purchases (HTTP 200) — zastosowana 2026-06-23')
ON CONFLICT (filename) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- KONTROLA — przeczytaj to, zanim uznasz, że poszło dobrze
-- ══════════════════════════════════════════════════════════════════════════
-- Ma wypisać 10 wierszy. Jeśli jest ich mniej, któraś sekcja nie
-- dopisała się do rejestru i trzeba zobaczyć dlaczego.
SELECT filename, applied_at, coalesce(note, '') AS note
  FROM public.applied_migrations
 ORDER BY filename;

COMMIT;

-- Po COMMIT odśwież pulpit (Unregister SW + clear cache). Panel MIGRACJE
-- w Diagnostics ma pokazać wszystkie pliki jako zastosowane, poza
-- 20261020_dedup_august_duplicates.sql,
-- który wklejasz osobno.
