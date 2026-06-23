-- Migration: add meta_purchases + meta_purchase_value to v_daily_wix_meta_performance
-- Date: 2026-06-23
-- Already applied manually in Supabase. This file is the authoritative repo copy.

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
         SELECT orders.order_created_at::date AS date,
            count(*) AS wix_orders,
            sum(orders.amount) AS wix_revenue
           FROM orders
          WHERE orders.source = 'wix'::text AND lower(orders.payment_status) = 'paid'::text AND orders.external_order_id !~~* 'TEST-%'::text AND orders.email !~~* '%test%'::citext
          GROUP BY (orders.order_created_at::date)
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
