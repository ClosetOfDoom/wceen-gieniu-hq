-- Test of 20261121_meta_ads_daily_keep_attribution.sql — ONE transaction, ends in ROLLBACK.
-- Paste the whole file into the Supabase SQL editor AFTER the migration. Nothing stays in the database:
-- the test row (date 1999-01-01, ad_id GUARD-TEST) and its log rows are rolled back.
-- Every check raises an EXCEPTION on failure, so "Success. No rows returned" means all passed.
-- The upserts use ON CONFLICT (date, campaign_id, adset_id, ad_id) — the key Make uses. If the
-- editor answers 42P10, the unique index in this database is a different one: say so, do not edit the test.

BEGIN;

INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 100, 5, '{"actions":[{"action_type":"purchase","value":"5"}]}');

-- 1. upsert with 0 after a positive value: the row keeps 5, spend still updates
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 120, 0, '{"actions":[{"action_type":"purchase","value":"5"}]}')
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE
  SET spend = EXCLUDED.spend, meta_purchases = EXCLUDED.meta_purchases, raw_payload = EXCLUDED.raw_payload;
DO $$ DECLARE r record; BEGIN
  SELECT spend, meta_purchases INTO r FROM public.meta_ads_daily WHERE ad_id = 'GUARD-TEST' AND date = '1999-01-01';
  IF r.meta_purchases::numeric <> 5 THEN RAISE EXCEPTION 'TEST 1 FAILED: zero overwrote 5 (now %)', r.meta_purchases; END IF;
  IF r.spend::numeric <> 120 THEN RAISE EXCEPTION 'TEST 1 FAILED: spend not updated (now %)', r.spend; END IF;
  RAISE NOTICE 'TEST 1 OK: upsert 0 → meta_purchases stays 5, spend 120';
END $$;

-- 2. upsert with NULL meta_purchases: kept
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 120, NULL, '{"actions":[]}')
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE
  SET meta_purchases = EXCLUDED.meta_purchases, raw_payload = EXCLUDED.raw_payload;
DO $$ DECLARE r record; BEGIN
  SELECT meta_purchases, raw_payload::text AS rp INTO r FROM public.meta_ads_daily WHERE ad_id = 'GUARD-TEST' AND date = '1999-01-01';
  IF r.meta_purchases IS NULL OR r.meta_purchases::numeric <> 5 THEN RAISE EXCEPTION 'TEST 2 FAILED: NULL overwrote 5 (now %)', r.meta_purchases; END IF;
  IF r.rp NOT LIKE '%"actions"%' THEN RAISE EXCEPTION 'TEST 2 FAILED: non-empty payload not written (now %)', r.rp; END IF;
  RAISE NOTICE 'TEST 2 OK: upsert NULL → meta_purchases stays 5; a non-empty new payload is written';
END $$;

-- 3. upsert with a HIGHER value: it goes through
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 130, 9, '{"actions":[{"action_type":"purchase","value":"9"}]}')
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE
  SET spend = EXCLUDED.spend, meta_purchases = EXCLUDED.meta_purchases, raw_payload = EXCLUDED.raw_payload;
DO $$ DECLARE r record; BEGIN
  SELECT meta_purchases INTO r FROM public.meta_ads_daily WHERE ad_id = 'GUARD-TEST' AND date = '1999-01-01';
  IF r.meta_purchases::numeric <> 9 THEN RAISE EXCEPTION 'TEST 3 FAILED: higher value refused (now %)', r.meta_purchases; END IF;
  RAISE NOTICE 'TEST 3 OK: upsert 9 → meta_purchases 9';
END $$;

-- 4. upsert with raw_payload NULL (and {} ): the previous payload stays
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 130, 9, NULL)
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend, meta_purchases, raw_payload)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 130, 9, '{}')
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;
DO $$ DECLARE r record; BEGIN
  SELECT raw_payload::text AS rp INTO r FROM public.meta_ads_daily WHERE ad_id = 'GUARD-TEST' AND date = '1999-01-01';
  IF r.rp IS NULL OR r.rp NOT LIKE '%"9"%' THEN RAISE EXCEPTION 'TEST 4 FAILED: empty payload erased the previous one (now %)', r.rp; END IF;
  RAISE NOTICE 'TEST 4 OK: upsert raw_payload NULL / {} → previous payload kept';
END $$;

-- 5. an upsert WITHOUT the columns (Make sending only spend) leaves them alone and logs nothing
INSERT INTO public.meta_ads_daily (date, campaign_id, adset_id, ad_id, spend)
VALUES ('1999-01-01', 'GUARD-C', 'GUARD-S', 'GUARD-TEST', 140)
ON CONFLICT (date, campaign_id, adset_id, ad_id) DO UPDATE SET spend = EXCLUDED.spend;

-- 6. the refusals are in the log: tests 1, 2 (meta_purchases) and 4 twice (raw_payload) = 4 rows
DO $$ DECLARE n_p int; n_r int; BEGIN
  SELECT count(*) FILTER (WHERE column_name = 'meta_purchases'), count(*) FILTER (WHERE column_name = 'raw_payload')
    INTO n_p, n_r FROM public.meta_ads_daily_guard_log WHERE ad_id = 'GUARD-TEST' AND row_date = '1999-01-01';
  IF n_p <> 2 OR n_r <> 2 THEN RAISE EXCEPTION 'TEST 6 FAILED: log has % meta_purchases and % raw_payload rows, expected 2 and 2', n_p, n_r; END IF;
  RAISE NOTICE 'TEST 6 OK: 2 refused meta_purchases + 2 refused raw_payload logged';
END $$;

ROLLBACK;
