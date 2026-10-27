# Ingest Meta → `meta_ads_daily` — jedno źródło prawdy o konfiguracji

Scenariusz w Make jest jedynym, który zapisuje do `meta_ads_daily`. Ten plik
mówi, czego ma żądać od Meta i jak to mapować. Jeśli coś w scenariuszu różni
się od tego, co jest tutaj — to scenariusz jest do poprawy, nie ten plik.

Referencyjną implementację tego samego wywołania ma repo:
[`src/lib/meta/insights.ts`](../src/lib/meta/insights.ts). Jest przetestowana
i poprawna, ale **nie ona zasila bazę** — zasila ją Make.

## Stan na 2026-10-27 — co działa, a co nie

Zmierzone, nie założone:

| element | stan |
|---|---|
| poziom = reklama | **DZIAŁA** — wiersze z 27.10 niosą `ad_name`: PP-COLD-NOWE-WIDEO (228,24 zł / 4 600 wyśw.) i PP-VID<2> (64,55 zł / 1 226) |
| `spend`, `impressions`, `clicks` | **DZIAŁAJĄ**, per reklama, odświeżane wstecz |
| `link_clicks` | działa |
| `meta_purchases` | **NIE DZIAŁA** — 5 w bazie przy 46 w Business Managerze za 20–26.10 |
| `meta_purchase_value` | nie działa (ta sama przyczyna) |
| `reach` | **kolumny nie ma** — migracja `20261003_…` niewgrana |
| `initiate_checkout` | **kolumny nie ma** — j.w. |

Czyli: **nie jest prawdą, że ingest pobiera poziom kampanii.** Pobiera poziom
reklamy. Brakuje jednego pola — liczby zakupów — i dwóch kolumn w bazie.

Nie jest też prawdą, że „Meta zaniża konwersje". To była nasza teza, nigdy
niesprawdzona, a zera, które zdawały się ją potwierdzać, brały się stąd.

## Wywołanie, którego scenariusz ma używać

```
GET https://graph.facebook.com/v21.0/{AD_ACCOUNT_ID}/insights
```

| parametr | wartość |
|---|---|
| `level` | `ad` |
| `time_increment` | `1` |
| `time_range` | `{"since":"<dziś − 7>","until":"<dziś>"}` |
| `limit` | `200`, z podążaniem za `paging.next` |
| `action_attribution_windows` | `7d_click,1d_view` |
| `fields` | patrz niżej |

`fields`, dokładnie:

```
date_start,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,
spend,impressions,clicks,reach,actions,action_values
```

### Okno 7 dni, nie „dzisiaj"

To jest powód, dla którego zakupy zostają na zerach. Meta przypisuje konwersję
po fakcie, w oknie 7 dni od kliknięcia. Dzień zapisany tego samego dnia ma
zero zakupów i **nigdy się nie poprawi**, jeśli scenariusz nigdy po niego nie
wraca. Widać to w danych: 20–25.10 to same zera, zakupy są tylko na 26.10.

Wydatek jest odświeżany wstecz (1–20.10 urosło z 9 090,73 do 9 294,76 zł), więc
scenariusz **już** wraca po stare dni. To znaczy, że `meta_purchases` najpewniej
nie trafia do payloadu upsertu — a PostgREST aktualizuje wyłącznie kolumny
obecne w payloadzie, więc istniejące zero zostaje nietknięte.

## Mapowanie na kolumny

| kolumna w `meta_ads_daily` | skąd |
|---|---|
| `date` | `date_start` |
| `campaign_id`, `campaign_name` | wprost |
| `adset_id`, `adset_name` | wprost |
| `ad_id`, `ad_name` | wprost |
| `spend`, `impressions`, `clicks` | wprost |
| `reach` | `reach` *(po wgraniu migracji)* |
| `link_clicks` | suma `actions[]` gdzie `action_type = "link_click"` |
| `meta_purchases` | suma `actions[]` gdzie `action_type = "purchase"` |
| `meta_purchase_value` | suma `action_values[]` gdzie `action_type = "purchase"` |
| `initiate_checkout` | suma `actions[]` gdzie `action_type = "initiate_checkout"` *(po migracji)* |

Upsert: `on_conflict = date,ad_id`.

### Dokładnie JEDEN action_type na metrykę

Meta zwraca ten sam zakup pod czterema nazwami. Zweryfikowane na żywym API
2026-10-03 za 26.09–02.10:

```
purchase                              53
offsite_conversion.fb_pixel_purchase  53
omni_purchase                         53
onsite_web_purchase                   53
```

To są **cztery nazwy tego samego zbioru 53 zakupów**, nie 212 zakupów.
Sumowanie dwóch z nich podwaja wynik — ten plik kiedyś to robił. Bierz
`purchase` i tylko `purchase`.

To samo dotyczy checkoutów: `initiate_checkout`,
`offsite_conversion.fb_pixel_initiate_checkout`, `onsite_web_initiate_checkout`
i `omni_initiated_checkout` dawały 203 w tym samym oknie.

## Kroki do wyklikania w Make

1. Otwórz scenariusz zapisujący do `meta_ads_daily`.
2. Moduł **Facebook Ads → Get Insights**.
3. **Level** → `Ad`. *(Prawdopodobnie już ustawione — wiersze mają `ad_name`.)*
4. **Time Increment** → `1 day`.
5. **Time Range** → `since = dziś − 7`, `until = dziś`. **To jest kluczowa
   zmiana.** Bez niej zakupy przypisane po fakcie nigdy nie dojdą.
6. **Fields** → wklej listę z sekcji wyżej.
7. **Action Attribution Windows** → `7d_click, 1d_view` (albo to, co pokazuje
   Twój widok w Business Managerze — ma się zgadzać, żeby liczby były
   porównywalne).
8. **Limit** → 200, włącz podążanie za `paging.next`.
9. W module **Supabase → Upsert** dodaj do mapowania `meta_purchases`,
   `meta_purchase_value` i `link_clicks` wg tabeli wyżej.
10. **`meta_purchases` musi być w payloadzie ZAWSZE, także gdy wynosi 0.**
    Jeśli Make pomija puste pola, zero nigdy nie nadpisze starego zera, ale
    i prawdziwa wartość nigdy nie nadpisze zera — to jest dokładnie ten błąd.
11. Dopiero po wgraniu `20261003_meta_reach_initiate_checkout.sql` dodaj
    `reach` i `initiate_checkout`. Bez kolumn upsert padnie.

## Koszt operacji w Make

**Zmiana poziomu na reklamę nie kosztuje nic — poziom reklamy już jest.**

Co kosztuje, to okno 7 dni zamiast jednego:

| wariant | wywołań API / przebieg | wierszy / przebieg |
|---|---|---|
| dziś, 1 dzień, 2–3 reklamy | 1 | 2–3 |
| ostatnie 7 dni, 2–3 reklamy | 1 | 14–21 |

Jedno `time_range` z `time_increment=1` to **jedno wywołanie**, niezależnie od
długości okna — paginacja włącza się dopiero powyżej 200 wierszy, a 21 to
daleko poniżej. W Make rośnie liczba operacji po stronie modułu zapisu: 21
wierszy zamiast 3 to **18 operacji więcej na przebieg**.

Przy przebiegu co 15 minut: 96 przebiegów/dobę × 18 = 1 728 operacji/dobę
więcej, czyli **ok. 52 000/miesiąc — ponad limit 10 000.**

Dlatego okna 7-dniowego **nie uruchamiaj co 15 minut.** Rozdziel na dwa
scenariusze:

- **intraday**, co 15 min, `time_range` = dziś: 3 wiersze × 96 = ~288
  operacji/dobę ≈ 8 600/miesiąc. Zostaje przy obecnym koszcie.
- **catch-up**, **raz na dobę**, `time_range` = ostatnie 7 dni: 21 wierszy × 1
  = 21 operacji/dobę ≈ 630/miesiąc.

Razem ≈ 9 230/miesiąc — mieści się w 10 000. Catch-up nadpisuje zera z dni,
które Meta przypisała po fakcie, i to on naprawia purchases.

## Jak sprawdzić, że zadziałało

```
npm run assert:meta-purchases -- --from 2026-10-20 --to 2026-10-26 \
  --expect 46 --spend 3375.52 --campaign "PP-22.06.2026"
```

Liczbę po `--expect` odczytujesz z Business Managera. Nie ma tu wywołania API,
które mogłoby ją potwierdzić — o to chodzi: pipeline nie może sam siebie
zaliczyć.

Dopóki to nie przechodzi:

- `META_PURCHASES_FIXED_ON` w `src/lib/orderWindow.ts` zostaje `null`,
  więc wszędzie pisze się **NIEPOBIERANE**, nie „0 zakupów";
- `META_WORLD_ACTIVE` zostaje `false`, więc sekcja ŚWIAT META się nie renderuje;
- CPA i ROAS liczone z `meta_purchases` nie wracają na pulpit.

Gdy przejdzie — ustaw `META_PURCHASES_FIXED_ON` na pierwszy dzień, od którego
Make zapisuje pole poprawnie, i dopiero wtedy włącz `META_WORLD_ACTIVE`.
