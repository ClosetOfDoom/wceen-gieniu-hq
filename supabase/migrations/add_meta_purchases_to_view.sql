-- Migration: add meta_purchases + meta_purchase_value to v_daily_wix_meta_performance
-- Date: 2026-06-23
--
-- BEFORE RUNNING:
--   1. Get the current view definition to verify the reconstruction below matches
--      your live Supabase view:
--
--         SELECT pg_get_viewdef('public.v_daily_wix_meta_performance', true);
--
--   2. Compare the output with the view body in CREATE OR REPLACE VIEW below.
--      If they differ (different date extraction, different orders table name,
--      different revenue column, etc.) — adjust the body to match your live SQL,
--      keeping the new meta_purchases + meta_purchase_value columns at the end.
--
-- WHAT THIS ADDS:
--   - meta_purchases      = SUM(meta_ads_daily.meta_purchases) per date
--   - meta_purchase_value = SUM(meta_ads_daily.meta_purchase_value) per date
--
-- Existing columns and their order are UNCHANGED.
-- The two new columns are appended AFTER ads_count.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_daily_wix_meta_performance AS
SELECT
  m.date,

  -- Meta ad spend (campaign sum per date)
  COALESCE(SUM(m.spend),        0)::numeric(12, 2) AS meta_spend,

  -- Wix orders (from orders table, grouped by order date)
  COALESCE(o.wix_orders,        0)                  AS wix_orders,
  COALESCE(o.wix_revenue,       0)::numeric(12, 2)  AS wix_revenue,

  -- Derived KPIs
  CASE
    WHEN COALESCE(o.wix_orders, 0) > 0
    THEN ROUND(COALESCE(SUM(m.spend), 0)::numeric / o.wix_orders, 2)
    ELSE NULL
  END                                                AS real_cpa,

  CASE
    WHEN COALESCE(SUM(m.spend), 0) > 0
    THEN ROUND(COALESCE(o.wix_revenue, 0)::numeric / COALESCE(SUM(m.spend), 0), 2)
    ELSE NULL
  END                                                AS real_roas,

  -- Meta engagement (campaign sum per date)
  COALESCE(SUM(m.impressions),  0)                  AS impressions,
  COALESCE(SUM(m.clicks),       0)                  AS clicks,
  COALESCE(SUM(m.link_clicks),  0)                  AS link_clicks,
  COUNT(*)                                           AS ads_count,

  -- NEW: Meta conversion data (same grouping as meta_spend)
  COALESCE(SUM(m.meta_purchases),      0)            AS meta_purchases,
  COALESCE(SUM(m.meta_purchase_value), 0)::numeric(12, 2) AS meta_purchase_value

FROM meta_ads_daily m

LEFT JOIN (
  SELECT
    -- Try order_date first; fall back to timestamp columns cast to Warsaw date.
    -- Adjust to match your actual orders table column if pg_get_viewdef differs.
    COALESCE(
      o.order_date,
      (o.order_created_at AT TIME ZONE 'Europe/Warsaw')::date,
      (o.created_at       AT TIME ZONE 'Europe/Warsaw')::date
    )                            AS date,
    COUNT(*)                     AS wix_orders,
    COALESCE(
      SUM(COALESCE(o.amount, o.total, o.price, 0)),
      0
    )::numeric(12, 2)            AS wix_revenue
  FROM orders o
  GROUP BY 1
) o ON o.date = m.date

GROUP BY m.date, o.wix_orders, o.wix_revenue;


-- Grant read access to anon key (same as existing tables/views)
GRANT SELECT ON public.v_daily_wix_meta_performance TO anon;
