-- Usunięcie 67 zduplikowanych zamówień z 15-20.08.2026
--
-- STATUS: NIEWYKONANE. Wklej ręcznie w edytorze SQL w Supabase — jedyne
--         poświadczenie dostępne po stronie repozytorium to klucz anon,
--         którego RLS i tak nie przepuszcza do tabeli orders.
--
-- Wygenerowane 2026-10-20 przez scripts/reconcile-wix-export.mjs
-- na podstawie pełnego eksportu płatności Wix. Pełna lista kasowanych
-- wierszy: docs/dedup_2026-08_duplicate_rows.md
--
-- CO SIĘ STAŁO
-- ---------------------------------------------------------------------------
-- W sierpniu Make wyczerpał limit operacji i scenariusze stanęły na sześć dni.
-- Zamówienia wklejono ręcznie, nadając external_order_id postać
-- "wix-<numer zamówienia Wix>". Po odblokowaniu limitu scenariusz pobrał część
-- tych samych zamówień ponownie, tym razem z prawdziwym UUID-em. Stąd 67 par:
-- jedno zamówienie, dwa wiersze.
--
-- CZEGO TEN SKRYPT NIE ROBI
-- ---------------------------------------------------------------------------
-- Nie kasuje po wzorcu. DELETE ... LIKE 'wix-%' zabrałby także 17 wierszy
-- z 13-14.08, których sync NIGDY nie pobrał ponownie — są jedyną kopią tamtej
-- sprzedaży i mają tu zostać:
--   wix-15159    2026-08-13T12:38:13+00:00     119.00 zł
--   wix-15160    2026-08-13T13:36:48+00:00     119.00 zł
--   wix-15161    2026-08-13T13:53:44+00:00     119.00 zł
--   wix-15162    2026-08-13T14:03:43+00:00     119.00 zł
--   wix-15164    2026-08-13T16:44:42+00:00     549.00 zł
--   wix-15165    2026-08-13T17:26:28+00:00     119.00 zł
--   wix-15166    2026-08-13T18:01:59+00:00     549.00 zł
--   wix-15167    2026-08-14T04:21:27+00:00     119.00 zł
--   wix-15168    2026-08-14T05:39:22+00:00     119.00 zł
--   wix-15169    2026-08-14T05:54:15+00:00     119.00 zł
--   wix-15171    2026-08-14T06:43:00+00:00     119.00 zł
--   wix-15170    2026-08-14T06:43:03+00:00     119.00 zł
--   wix-15172    2026-08-14T06:43:57+00:00     119.00 zł
--   wix-15173    2026-08-14T07:16:31+00:00     119.00 zł
--   wix-15174    2026-08-14T08:39:15+00:00     119.00 zł
--   wix-15175    2026-08-14T08:45:38+00:00     119.00 zł
--   wix-15180    2026-08-14T22:11:09+00:00     119.00 zł
--
-- KOLEJNOŚĆ MA ZNACZENIE
-- ---------------------------------------------------------------------------
-- Wiersz z wklejki niesie coś, czego wiersz z UUID-em nie ma nigdzie indziej:
-- numer zamówienia Wix. Dlatego krok 3 przepisuje numer na wiersz, który
-- zostaje, a dopiero krok 4 kasuje wklejkę. Jeśli kolumna wix_order_number
-- jeszcze nie istnieje (20261019_wix_order_number.sql niewgrane), krok 3 sam
-- się pominie i powie o tym — numery i tak są zapisane w pliku w repozytorium,
-- więc da się je odtworzyć później.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ILE WIERSZY ZNIKNIE  (ma wyjść dokładnie 67)
-- ─────────────────────────────────────────────────────────────────────────────
SELECT count(*) AS do_skasowania
  FROM public.orders
 WHERE external_order_id IN (
    'wix-15181',
    'wix-15182',
    'wix-15184',
    'wix-15185',
    'wix-15186',
    'wix-15187',
    'wix-15188',
    'wix-15189',
    'wix-15190',
    'wix-15191',
    'wix-15193',
    'wix-15194',
    'wix-15195',
    'wix-15196',
    'wix-15197',
    'wix-15198',
    'wix-15199',
    'wix-15200',
    'wix-15201',
    'wix-15202',
    'wix-15203',
    'wix-15204',
    'wix-15205',
    'wix-15206',
    'wix-15207',
    'wix-15208',
    'wix-15209',
    'wix-15210',
    'wix-15211',
    'wix-15212',
    'wix-15213',
    'wix-15214',
    'wix-15215',
    'wix-15216',
    'wix-15217',
    'wix-15218',
    'wix-15219',
    'wix-15220',
    'wix-15221',
    'wix-15222',
    'wix-15223',
    'wix-15224',
    'wix-15225',
    'wix-15226',
    'wix-15227',
    'wix-15228',
    'wix-15229',
    'wix-15230',
    'wix-15231',
    'wix-15232',
    'wix-15233',
    'wix-15234',
    'wix-15235',
    'wix-15236',
    'wix-15237',
    'wix-15238',
    'wix-15239',
    'wix-15240',
    'wix-15241',
    'wix-15242',
    'wix-15243',
    'wix-15244',
    'wix-15245',
    'wix-15246',
    'wix-15247',
    'wix-15248',
    'wix-15249'
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. STRAŻNIK — przerywa całość, jeśli liczba się nie zgadza
-- ─────────────────────────────────────────────────────────────────────────────
DO $guard$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.orders
   WHERE external_order_id IN (
    'wix-15181',
    'wix-15182',
    'wix-15184',
    'wix-15185',
    'wix-15186',
    'wix-15187',
    'wix-15188',
    'wix-15189',
    'wix-15190',
    'wix-15191',
    'wix-15193',
    'wix-15194',
    'wix-15195',
    'wix-15196',
    'wix-15197',
    'wix-15198',
    'wix-15199',
    'wix-15200',
    'wix-15201',
    'wix-15202',
    'wix-15203',
    'wix-15204',
    'wix-15205',
    'wix-15206',
    'wix-15207',
    'wix-15208',
    'wix-15209',
    'wix-15210',
    'wix-15211',
    'wix-15212',
    'wix-15213',
    'wix-15214',
    'wix-15215',
    'wix-15216',
    'wix-15217',
    'wix-15218',
    'wix-15219',
    'wix-15220',
    'wix-15221',
    'wix-15222',
    'wix-15223',
    'wix-15224',
    'wix-15225',
    'wix-15226',
    'wix-15227',
    'wix-15228',
    'wix-15229',
    'wix-15230',
    'wix-15231',
    'wix-15232',
    'wix-15233',
    'wix-15234',
    'wix-15235',
    'wix-15236',
    'wix-15237',
    'wix-15238',
    'wix-15239',
    'wix-15240',
    'wix-15241',
    'wix-15242',
    'wix-15243',
    'wix-15244',
    'wix-15245',
    'wix-15246',
    'wix-15247',
    'wix-15248',
    'wix-15249'
   );
  IF n <> 67 THEN
    RAISE EXCEPTION 'Spodziewano się 67 wierszy, jest %. Nic nie usunięto — baza zmieniła się od czasu pomiaru, przelicz od nowa.', n;
  END IF;
END
$guard$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PRZEPISANIE NUMERU ZAMÓWIENIA NA WIERSZ, KTÓRY ZOSTAJE
--    Pomija się samo, jeśli kolumny jeszcze nie ma.
-- ─────────────────────────────────────────────────────────────────────────────
DO $carry$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name   = 'orders'
                AND column_name  = 'wix_order_number') THEN
    EXECUTE $sql$
      WITH para (wklejka, zostaje, numer) AS (VALUES
    ('wix-15181', '21346d51-aaf6-490f-810f-4b35183700dd', 15181),
    ('wix-15182', 'c9004b0e-2a55-46dd-8200-39123cde26d4', 15182),
    ('wix-15184', '9b6b02f7-eee6-4847-8aeb-6eef3594f5e3', 15184),
    ('wix-15185', 'b663111f-5e2a-42d9-8242-68023117ff8a', 15185),
    ('wix-15186', '3494636e-eac6-4050-8092-1c014ddccf07', 15186),
    ('wix-15187', 'e637fe48-20ac-410a-8271-b0cdf468db62', 15187),
    ('wix-15188', 'ea9135d5-3cf5-4264-8d4f-10c4c406414e', 15188),
    ('wix-15189', '9f2fbe4d-0b53-4552-889a-346062fad1c6', 15189),
    ('wix-15190', 'a2838a9b-bc49-417c-9d9a-1d77239b37d6', 15190),
    ('wix-15191', '46be6a5d-549d-4aaf-9e5c-ff71670bb4d1', 15191),
    ('wix-15193', 'ea835aed-aab2-4240-9d71-16b77da2de72', 15193),
    ('wix-15194', 'bcb4a40b-42ac-498f-a2f7-b71ee37caedb', 15194),
    ('wix-15195', '57d4aa5b-5cca-43e1-ba94-e89a39d2a060', 15195),
    ('wix-15196', '936d3ab9-4f32-48ff-8c00-3f7567317723', 15196),
    ('wix-15197', '186c3bd3-97d5-479b-ad7f-dae560929766', 15197),
    ('wix-15198', '3f29d685-b523-4021-a05f-c08cddccacfc', 15198),
    ('wix-15199', '110939df-7e30-4edd-9533-8f9de3c19a00', 15199),
    ('wix-15200', '657a57be-8f44-4097-8742-abc05d480f60', 15200),
    ('wix-15201', '1422ae04-2d1d-41ad-91cd-e2ac83980acb', 15201),
    ('wix-15202', '2bef5dd2-c5d6-4fb8-a85e-a0a333c3d74b', 15202),
    ('wix-15203', 'b8d28234-3f80-4dd7-bdd3-c7a5a45f556e', 15203),
    ('wix-15204', '35691398-6827-405d-81f6-a64515eafc1e', 15204),
    ('wix-15205', '5f52f460-f85f-4552-ba04-c0461e04da76', 15205),
    ('wix-15206', 'af366f87-8f4a-40a0-b84f-af9f523252d0', 15206),
    ('wix-15207', 'f018bb20-79aa-49d7-9300-aa64992e7479', 15207),
    ('wix-15208', '94a0f23c-17a0-4b5b-8d46-981c77c24f45', 15208),
    ('wix-15209', 'b4477d60-eb56-464e-b1a5-8b54337499ce', 15209),
    ('wix-15210', '4050ce0b-5277-42d3-b76e-95aeecad9bb0', 15210),
    ('wix-15211', '5bdd6850-1944-4fd9-b2f5-98e4e4a24363', 15211),
    ('wix-15212', 'c633612c-b9b5-401b-b32f-4351b3c78321', 15212),
    ('wix-15213', '7ea5a0aa-3c30-4fef-84b9-5d7e4c07cf09', 15213),
    ('wix-15214', 'c4dc4df7-0162-4697-af55-07c7de1ed93f', 15214),
    ('wix-15215', '744be5cb-390f-4a2f-8611-6aad3d6af052', 15215),
    ('wix-15216', 'e04995cd-9178-46ab-b68b-3f2ac2945452', 15216),
    ('wix-15217', '324cd5cd-479c-445b-915b-e6e196f8f367', 15217),
    ('wix-15218', '1b804a08-ee31-4bec-8b26-68ad3cc1ab0a', 15218),
    ('wix-15219', '1aa9da93-806e-4a61-b8eb-3b26cee7d124', 15219),
    ('wix-15220', 'ab411d14-03d6-4204-9f14-d884b79cf20b', 15220),
    ('wix-15221', '2ae63aae-6d9f-4109-b6c0-daff1409b615', 15221),
    ('wix-15222', '96d4fef1-b314-442c-8a38-394c8ea629cf', 15222),
    ('wix-15223', 'b2b3c2a4-4452-4c47-ae02-815e3f33f379', 15223),
    ('wix-15224', '81baeedd-4801-4433-98a8-d119d3f96119', 15224),
    ('wix-15225', 'f88b828e-b05b-4305-a41c-dab6ad5bbb5f', 15225),
    ('wix-15226', '3c41bc77-83f9-41ea-878a-fba29d8e4c6d', 15226),
    ('wix-15227', '6c950e6e-7622-42a9-8b2f-e1df41116796', 15227),
    ('wix-15228', 'c7b1222b-5608-4453-b5dc-0437f1320182', 15228),
    ('wix-15229', '82caedb8-2819-4260-991a-2fbe72d9f3dd', 15229),
    ('wix-15230', '41da22b6-4bdc-4eb0-83fd-c20ff7e78e46', 15230),
    ('wix-15231', '98067bee-d1b2-49a5-ab33-1a578f5d3a0c', 15231),
    ('wix-15232', '8c4f9282-aec8-4da0-856e-c1e32e80ac93', 15232),
    ('wix-15233', 'e5d357f8-bfee-45c2-9a02-3b7a5bacddb8', 15233),
    ('wix-15234', 'a9c2dc2f-6c4c-4eaf-9a86-182a52c7a773', 15234),
    ('wix-15235', '7cbf1044-4972-498e-959d-021196e4f273', 15235),
    ('wix-15236', '1cfee7b5-7db6-4764-9cfd-c661cd780f1e', 15236),
    ('wix-15237', 'e87e9eff-e93c-4a00-b61c-871c5f4d4a9f', 15237),
    ('wix-15238', '13bdcbd6-7991-4c70-b523-771f90725075', 15238),
    ('wix-15239', '8076bde1-3306-4fbf-a591-c7b57fa6feda', 15239),
    ('wix-15240', '21acac51-f4e9-45c9-b06c-023ca8e0981c', 15240),
    ('wix-15241', 'e729237e-63c4-4189-987d-68ab4378cb29', 15241),
    ('wix-15242', 'dd184c25-4beb-472f-9178-97523f339bac', 15242),
    ('wix-15243', '4d63e600-f6cb-48ca-b1a3-9bf3e6936aba', 15243),
    ('wix-15244', 'bc717a86-05e4-4973-8821-4902dac9e483', 15244),
    ('wix-15245', '55d4fca2-71c7-42c0-85f4-6d009aa467bc', 15245),
    ('wix-15246', '02d4509a-9de1-4ebe-a47c-7b55846118d8', 15246),
    ('wix-15247', '10c39e74-357b-4453-a7f1-7ab667e1a458', 15247),
    ('wix-15248', 'd43788f9-5c49-450b-b8bb-c93b0b3abdad', 15248),
    ('wix-15249', 'cb93846f-d75c-43dd-a582-536bbae94fc6', 15249)
      )
      UPDATE public.orders o
         SET wix_order_number = para.numer
        FROM para
       WHERE o.external_order_id = para.zostaje
         AND o.wix_order_number IS NULL
    $sql$;
    RAISE NOTICE 'Numery zamówień przepisane na wiersze z UUID-em.';
  ELSE
    RAISE NOTICE 'Kolumna orders.wix_order_number nie istnieje — numery NIE zostały przepisane.';
    RAISE NOTICE 'Numery nie przepadną: są w docs/dedup_2026-08_duplicate_rows.md.';
    RAISE NOTICE 'Chcesz je mieć w bazie? Przerwij (ROLLBACK), wgraj 20261019_wix_order_number.sql, uruchom to ponownie.';
  END IF;
END
$carry$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. USUNIĘCIE — wyłącznie te 67 identyfikatorów, każdy z nazwy
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.orders
 WHERE external_order_id IN (
    'wix-15181',
    'wix-15182',
    'wix-15184',
    'wix-15185',
    'wix-15186',
    'wix-15187',
    'wix-15188',
    'wix-15189',
    'wix-15190',
    'wix-15191',
    'wix-15193',
    'wix-15194',
    'wix-15195',
    'wix-15196',
    'wix-15197',
    'wix-15198',
    'wix-15199',
    'wix-15200',
    'wix-15201',
    'wix-15202',
    'wix-15203',
    'wix-15204',
    'wix-15205',
    'wix-15206',
    'wix-15207',
    'wix-15208',
    'wix-15209',
    'wix-15210',
    'wix-15211',
    'wix-15212',
    'wix-15213',
    'wix-15214',
    'wix-15215',
    'wix-15216',
    'wix-15217',
    'wix-15218',
    'wix-15219',
    'wix-15220',
    'wix-15221',
    'wix-15222',
    'wix-15223',
    'wix-15224',
    'wix-15225',
    'wix-15226',
    'wix-15227',
    'wix-15228',
    'wix-15229',
    'wix-15230',
    'wix-15231',
    'wix-15232',
    'wix-15233',
    'wix-15234',
    'wix-15235',
    'wix-15236',
    'wix-15237',
    'wix-15238',
    'wix-15239',
    'wix-15240',
    'wix-15241',
    'wix-15242',
    'wix-15243',
    'wix-15244',
    'wix-15245',
    'wix-15246',
    'wix-15247',
    'wix-15248',
    'wix-15249'
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SPRAWDZENIE PO USUNIĘCIU
-- ─────────────────────────────────────────────────────────────────────────────
-- Dni liczone wg doby warszawskiej, tak jak liczy je pulpit.
SELECT (order_created_at AT TIME ZONE 'Europe/Warsaw')::date AS doba,
       count(*)                                              AS zamowien,
       sum(amount)                                           AS przychod
  FROM public.orders
 WHERE (order_created_at AT TIME ZONE 'Europe/Warsaw')::date
         BETWEEN DATE '2026-08-15' AND DATE '2026-08-20'
   AND lower(coalesce(payment_status, 'paid')) = 'paid'
   AND coalesce(source, 'wix') = 'wix'
 GROUP BY 1
 ORDER BY 1;

-- MA WYJŚĆ (zmierzone na eksporcie Wix, po odjęciu duplikatów):
--   2026-08-15    13 zamówień      1428.00 zł
--   2026-08-16    13 zamówień      1547.00 zł
--   2026-08-17    14 zamówień      1666.00 zł
--   2026-08-18    11 zamówień      1598.50 zł
--   2026-08-19    14 zamówień      1646.90 zł
--   2026-08-20    12 zamówień      1734.00 zł

-- Zgadza się? COMMIT;
-- Nie zgadza się? ROLLBACK; — i napisz, co wyszło.
COMMIT;
