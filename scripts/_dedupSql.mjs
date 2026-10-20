// Renders the August de-duplication SQL and the paper trail that goes with it.
//
// Kept out of reconcile-wix-export.mjs because it is a template, not a
// measurement: the reconciler decides WHICH rows are duplicates, this decides
// how that decision is written down. Neither knows the other's business.
//
// The SQL it produces names every row it touches. It never deletes by pattern:
// `LIKE 'wix-%'` would also take the 17 hand-pasted rows that the sync never
// re-fetched, and those are the only copy of real sales.

const money = (n) => Number(n).toFixed(2)

/**
 * The repair script, for pasting into the Supabase SQL editor.
 *
 * One transaction. It refuses to run if the row count is not exactly what was
 * measured, copies the Wix order numbers off the rows it is about to delete,
 * then deletes them by name.
 */
export function renderDedupSql({ ordered, soloPasted, total, expectedAfter, generatedAt }) {
  const ids = ordered.map(x => `    '${x.pasted.order_id}'`).join(',\n')
  const values = ordered
    .map(x => `    ('${x.pasted.order_id}', '${x.uuid.order_id}', ${x.pasted.order_id.slice(4)})`)
    .join(',\n')
  const soloList = soloPasted
    .map(o => `--   ${o.order_id.padEnd(12)} ${o.order_created_at}  ${money(o.amount).padStart(9)} zł`)
    .join('\n')
  const afterRows = expectedAfter
    .map(d => `--   ${d.day}   ${String(d.orders).padStart(3)} zamówień   ${money(d.revenue).padStart(10)} zł`)
    .join('\n')

  return `-- Usunięcie ${ordered.length} zduplikowanych zamówień z 15-20.08.2026
--
-- STATUS: NIEWYKONANE. Wklej ręcznie w edytorze SQL w Supabase — jedyne
--         poświadczenie dostępne po stronie repozytorium to klucz anon,
--         którego RLS i tak nie przepuszcza do tabeli orders.
--
-- Wygenerowane ${generatedAt} przez scripts/reconcile-wix-export.mjs
-- na podstawie pełnego eksportu płatności Wix. Pełna lista kasowanych
-- wierszy: docs/dedup_2026-08_duplicate_rows.md
--
-- CO SIĘ STAŁO
-- ---------------------------------------------------------------------------
-- W sierpniu Make wyczerpał limit operacji i scenariusze stanęły na sześć dni.
-- Zamówienia wklejono ręcznie, nadając external_order_id postać
-- "wix-<numer zamówienia Wix>". Po odblokowaniu limitu scenariusz pobrał część
-- tych samych zamówień ponownie, tym razem z prawdziwym UUID-em. Stąd ${ordered.length} par:
-- jedno zamówienie, dwa wiersze.
--
-- CZEGO TEN SKRYPT NIE ROBI
-- ---------------------------------------------------------------------------
-- Nie kasuje po wzorcu. DELETE ... LIKE 'wix-%' zabrałby także ${soloPasted.length} wierszy
-- z 13-14.08, których sync NIGDY nie pobrał ponownie — są jedyną kopią tamtej
-- sprzedaży i mają tu zostać:
${soloList}
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
-- 1. ILE WIERSZY ZNIKNIE  (ma wyjść dokładnie ${ordered.length})
-- ─────────────────────────────────────────────────────────────────────────────
SELECT count(*) AS do_skasowania
  FROM public.orders
 WHERE external_order_id IN (
${ids}
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
${ids}
   );
  IF n <> ${ordered.length} THEN
    RAISE EXCEPTION 'Spodziewano się ${ordered.length} wierszy, jest %. Nic nie usunięto — baza zmieniła się od czasu pomiaru, przelicz od nowa.', n;
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
${values}
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
-- 4. USUNIĘCIE — wyłącznie te ${ordered.length} identyfikatorów, każdy z nazwy
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.orders
 WHERE external_order_id IN (
${ids}
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
${afterRows}

-- Zgadza się? COMMIT;
-- Nie zgadza się? ROLLBACK; — i napisz, co wyszło.
COMMIT;
`
}

/** The paper trail: every row the SQL removes, and every number it carries. */
export function renderDedupTrace({ ordered, soloPasted, pastedBatches, total, generatedAt }) {
  const rows = ordered.map(x =>
    `| ${x.pasted.order_id} | ${x.uuid.order_id} | ${x.pasted.order_created_at} | ${money(x.pasted.amount)} | `
    + `${String(x.pasted.product_name_raw ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 56)} |`).join('\n')
  const solo = soloPasted.map(o =>
    `| ${o.order_id} | ${o.order_created_at} | ${money(o.amount)} | `
    + `${String(o.product_name_raw ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 56)} |`).join('\n')
  const batches = pastedBatches.map(([at, n]) => `- \`${at}\` — ${n} wierszy`).join('\n')

  return `# Duplikaty z 15-20.08.2026 — co zostało usunięte i dlaczego

Wygenerowane ${generatedAt} przez \`scripts/reconcile-wix-export.mjs\`.
SQL: \`supabase/migrations/20261020_dedup_august_duplicates.sql\`.

Ten plik jest śladem. Po wykonaniu DELETE tylko tutaj zostaje zapis, że te
wiersze kiedykolwiek istniały — i tylko tutaj zostają **numery zamówień Wix**,
jeśli SQL przepisał je przy niewgranej kolumnie \`orders.wix_order_number\`.

## Co się stało

Make wyczerpał limit operacji i scenariusze stanęły na sześć dni. Zamówienia
wklejono ręcznie, z \`external_order_id\` w postaci \`wix-<numer zamówienia Wix>\`.
Po odblokowaniu limitu scenariusz pobrał część tych samych zamówień jeszcze
raz, już z prawdziwym UUID-em.

Wklejki wg \`inserted_at\`:

${batches}

Z nich ${ordered.length} zostało zdublowanych i jest do usunięcia, a ${soloPasted.length} nie ma pary
i musi zostać.

## Do usunięcia — ${ordered.length} wierszy, ${money(total)} zł

Usuwany jest wiersz z wklejki. Zostaje wiersz z UUID-em: niesie własne id Wix
i pełną precyzję \`order_created_at\` (wklejka zaokrągliła do pełnej sekundy).
Kolumna "numer" to liczba wyjęta z \`external_order_id\` wklejki — jedyne
miejsce w bazie, gdzie numer zamówienia Wix w ogóle występuje.

| usuwany (wklejka) | zostaje (UUID) | order_created_at | kwota | produkt |
|---|---|---|---|---|
${rows}

## NIE usuwać — ${soloPasted.length} wierszy bez pary

Sync nigdy nie pobrał ich ponownie. To jedyna kopia tej sprzedaży.
\`DELETE ... LIKE 'wix-%'\` zabrałby je razem z duplikatami.

| external_order_id | order_created_at | kwota | produkt |
|---|---|---|---|
${solo}
`
}
