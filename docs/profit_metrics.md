# Profit Metrics — Methodology

## What "Estimated Profit" Means

The "Est. Profit" KPI card and GIENIU "ile na czysto" command show **operational profit after ad spend**.

This is NOT:
- Net accounting profit (does not subtract fixed costs, salaries, infrastructure)
- Tax profit (no VAT or income tax adjustments)
- Lifetime value or retention-adjusted margin

This IS:
- Contribution margin from today's Wix orders (product-level, per-unit)
- Minus today's Meta ad spend (from `v_daily_wix_meta_performance`, fallback to `meta_ads_daily`)

Formula:
```
Estimated Profit = Σ(contributionMargin × ordersCount per product) − adSpend
```

## Product Margin Rules

| Product | Price (PLN) | Contribution Margin (PLN) | Status |
|---|---|---|---|
| Pakiet pamięciowy | 119 | 70 | Known |
| Pakiet językowy | 114 | 40 | Known |
| Kurs Jak się uczyć | 549 | — | Configurable |
| Językozak AI | 347 | — | Configurable |
| Unknown | any other | — | Unmapped |

Contribution margins are set in `src/services/productMargins.ts` and mirrored in `netlify/functions/profit-data.js`.

## Unknown Products / Unmapped Revenue

If an order's amount does not match any known price point, or if the product's margin is not configured (Kurs JSU, Językozak AI), the revenue is counted as **unmapped** and excluded from profit calculation.

The dashboard shows an "Unmapped Revenue" KPI card with a warning when unmapped revenue > 0.

To add a margin for JSU or Językozak AI, set `contributionMargin` in both:
- `src/services/productMargins.ts`
- `netlify/functions/profit-data.js` (MARGIN_RULES array)

## Ad Spend Source Priority

1. `v_daily_wix_meta_performance` — same aggregated view used by Command Center (preferred)
2. `meta_ads_daily` — raw campaign rows, summed by date (fallback)

The `adSpendSource` field in the `/profit-data` response tells you which source was used.

## Visual Color Logic

| Condition | Color |
|---|---|
| Profit > 100 PLN | Green (positive) |
| Profit 0–100 PLN | Orange (warning — covering costs, but barely) |
| Profit < 0 PLN | Red (danger — spending more than earning) |
| Unmapped revenue > 0 | Orange warning row |

## Endpoint

`GET /.netlify/functions/profit-data`

Returns: `{ ok, dateWarsaw, ordersCount, revenue, adSpend, adSpendSource, knownMargin, unknownRevenue, unknownOrdersCount, marginBeforeAds, estimatedProfitAfterAds, estimatedProfitPerOrder, productBreakdown, unmappedOrders }`

Always includes `Cache-Control: no-store` to prevent stale profit figures.

## GIENIU Commands

| Command | Response |
|---|---|
| ile na czysto | Full profit breakdown with verdict |
| zysk dzisiaj | Same |
| profit today | Same |
| ile zarobiliśmy | Same |
| czy to się opłaca | Same |
| zysk po reklamie | Same |
| jaka marża | Same |
