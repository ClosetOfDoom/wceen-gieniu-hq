-- Migration: add wix_order_items table for product-level classification
-- Run this AFTER updating the Make → Wix → Supabase scenario to save line items.
-- See docs/wix_orders_product_mapping_fix.md for full instructions.

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

-- Row-level security: allow anon reads (same policy as other tables)
ALTER TABLE public.wix_order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read" ON public.wix_order_items
  FOR SELECT USING (true);
