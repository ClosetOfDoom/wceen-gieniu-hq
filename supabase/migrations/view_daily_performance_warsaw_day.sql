-- Migration: bucket v_daily_wix_meta_performance by the WARSAW calendar day
-- Date: 2026-09-07
-- STATUS: NOT YET APPLIED. This needs running by hand in the Supabase SQL
--         editor — the agent has no GUI access. Until it runs, the view and the
--         app disagree about where a day ends (see below).
--
-- WHY
-- ---------------------------------------------------------------------------
-- The `wix` CTE buckets orders with `orders.order_created_at::date`. That column
-- is a timestamptz, so `::date` yields the UTC calendar day. Warsaw is UTC+2 in
-- summer, so every order placed between 22:00 and 24:00 UTC — i.e. midnight to
-- 02:00 the next day in Warsaw — is counted on the PREVIOUS day by this view.
--
-- The whole application buckets by the Warsaw day (toWarsawDate in
-- netlify/shared/productCatalog.js), which is the business's own calendar.
-- So the two disagree by exactly the orders in that two-hour window:
--
--   2026-09-06   view 23 orders / 2 729.00 PLN   ·   app 22 / 2 610.00
--   2026-09-07   view 11 orders / 1 309.00 PLN   ·   app 12 / 1 428.00
--   two-day sum  view 34 / 4 038.00              ·   app 34 / 4 038.00
--
-- Identical totals, different day boundary. Nothing is lost or truncated; the
-- Wix Orders card and Est. Profit simply cut the day in different places, and on
-- any given day one of them is wrong about "today".
--
-- AT_TIME_ZONE below converts to Warsaw local time BEFORE taking the date, and
-- handles the DST switch on its own. `meta_ads_daily.date` is already a plain
-- date supplied by the Meta ingest and is left alone.

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

-- NOTE on real_cpa / real_roas in this view: they divide by EVERY paid order,
-- including WSZTP, which the application deliberately excludes from its blended
-- figures (netlify/shared/productCatalog.js, excludeFromBlendedProfit). The view
-- has no way to express that, so the dashboard reads CPA and ROAS from the
-- profit-data endpoint instead and treats these two columns as a fallback only.
