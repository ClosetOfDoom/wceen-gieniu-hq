-- Migration: bucket v_daily_wix_meta_performance by the WARSAW business day
-- Raised: 2026-09-07 (predicted).  Confirmed against live data: 2026-09-28.
--
-- STATUS: NOT APPLIED. Run this by hand in the Supabase SQL editor — the only
--         Supabase credential available here is the anon key, which cannot
--         execute DDL. Nothing in the application can work around it, and
--         nothing tries to: the fix belongs in the view.
--
-- WHAT IS WRONG
-- ---------------------------------------------------------------------------
-- The `wix` CTE buckets orders with `orders.order_created_at::date`.
-- order_created_at is a timestamptz (confirmed: the REST API returns values of
-- the form '2026-09-25T13:35:12.005+00:00'), so `::date` yields the UTC
-- calendar day. Warsaw is UTC+2 in summer, so an order placed between 00:00 and
-- 01:59 local time carries the PREVIOUS day's UTC date.
--
-- Measured on 2026-09-28, against what Wix actually shows:
--
--   day          view (UTC ::date)   profit-data (Warsaw)   Wix (truth)
--   2026-09-27   15 / 1 785,00 PLN   12 / 1 428,00 PLN      12
--   2026-09-28    1 /   119,00 PLN    4 /   476,00 PLN       4
--
-- Three orders sat on the wrong day. The application already cuts the day in
-- Warsaw (netlify/shared/businessDay.js), so this view is the one side still
-- disagreeing — which is why Est. Profit and the PP counter were right while
-- the Wix Orders card, Revenue Trend and Stanley's "today" were wrong.
--
-- WHY `AT TIME ZONE` AND NOT AN OFFSET
-- ---------------------------------------------------------------------------
-- `AT TIME ZONE 'Europe/Warsaw'` applied to a timestamptz converts to Warsaw
-- local time and handles the DST switch itself. Poland returns to CET (UTC+1)
-- on 2026-10-25; a hardcoded `- interval '2 hours'` would be wrong from that
-- Sunday on. For a timestamp WITHOUT time zone the expression would need to be
-- ((order_created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Warsaw')::date —
-- not the case here, the column is timestamptz.
--
-- meta_ads_daily.date is left untouched: Meta reports in the ad account's own
-- timezone and already stores a plain date. The FULL JOIN below therefore lines
-- a Warsaw order-day up against a Meta ad-day; they agree for whole days, and
-- that is the same basis Ads Manager is read on.
--
-- CREATE OR REPLACE VIEW cannot add, remove, rename or reorder columns, so the
-- select list below is byte-for-byte the current one. Only the two `wix` CTE
-- expressions change.

-- ─────────────────────────────────────────────────────────────────────────────
-- WKLEJ RĘCZNIE W SUPABASE SQL EDITOR
-- ─────────────────────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────────────────────
-- SPRAWDZENIE PO WKLEJENIU — powinno dać 2026-09-27 = 12 i 2026-09-28 = 4
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT date, wix_orders, wix_revenue
--   FROM public.v_daily_wix_meta_performance
--  WHERE date BETWEEN '2026-09-27' AND '2026-09-28'
--  ORDER BY date;

-- NOTE on real_cpa / real_roas in this view: they divide by EVERY paid order,
-- including WSZTP, which the application deliberately excludes from its blended
-- figures (netlify/shared/productCatalog.js, excludeFromBlendedProfit). The view
-- has no way to express that, so the dashboard reads CPA and ROAS from the
-- profit-data endpoint instead and treats these two columns as a fallback only.
