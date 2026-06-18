# Wix Orders — Product Mapping Fix

## Problem

GIENIU cannot answer product-specific questions like "how many memory bundles did we sell today."

**Root cause:** The Make → Wix → Supabase scenario saves orders to `v_daily_wix_meta_performance`, which is an aggregate VIEW exposing only:

```
date, meta_spend, wix_orders, wix_revenue, real_cpa, real_roas, impressions, clicks, link_clicks, ads_count
```

There are no product names, SKUs, or line items. All orders are `UNKNOWN_UNCLASSIFIABLE`.

## Required Fix

### Step 1 — Create `wix_order_items` table in Supabase

Run migration: `supabase/migrations/add_order_items_for_product_scoping.sql`

```sql
CREATE TABLE public.wix_order_items (
  id              text        PRIMARY KEY,
  order_id        text        NOT NULL,
  order_date      date        NOT NULL,
  product_name    text,
  product_sku     text,
  quantity        integer     DEFAULT 1,
  line_total      numeric(10,2),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX ON public.wix_order_items (order_date);
CREATE INDEX ON public.wix_order_items (product_sku);
```

### Step 2 — Update the Make scenario

In the Wix → Supabase Make scenario, add a step after the order fetch that:

1. Iterates `order.lineItems` from the Wix Orders API response
2. For each line item, inserts a row into `wix_order_items` with:
   - `order_id` = the Wix order ID
   - `order_date` = the order date
   - `product_name` = `lineItem.name`
   - `product_sku` = `lineItem.catalogReference.catalogItemId` (or `lineItem.sku`)
   - `quantity` = `lineItem.quantity`
   - `line_total` = `lineItem.price.amount * lineItem.quantity`

### Step 3 — Update GIENIU product classifier

Once `wix_order_items` has rows, `src/lib/dataAudit.ts` will detect `product_name` and set `classificationAvailable = true`.

`src/lib/productClassifier.ts` already has pattern matchers for:
- `MEMORY_PACK` — "pakiet pamieci", "memory pack", "memory bundle"
- `JSU_COURSE` — "jak sie uczyc", "jsu", "kurs jak sie"
- `MEMORY_BOOK` — "memory book", "ksiazka o pamieci"
- `JZK_LANGUAGE` — "jezykozak", "nauka jezykow", "jzk"
- `WSZTP` — "wsztp", "wszystko trzeba"
- `MARITIME` — "szanty", "shanty"
- `OTHER` — any unrecognised product name

### Step 4 — Update intent handlers

After the data is available, the `memory_product_scope` intent in `src/brain/intent.ts` must be updated to:
1. Fetch today's rows from `wix_order_items` grouped by product
2. Filter for `MEMORY_PACK` classified SKUs
3. Return the real count, not the aggregate total

## Current status

As of this commit: product classification is **UNAVAILABLE**.

GIENIU will respond to "how many memory bundles" with an honest error message explaining the data gap, not a fake number using all-order totals.

The `PRODUCT_CLASSIFICATION_AVAILABLE = false` constant in `src/lib/productClassifier.ts` gates all product-specific reports.
