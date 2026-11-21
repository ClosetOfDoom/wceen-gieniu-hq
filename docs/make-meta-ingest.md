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

## Poprawka 2026-11-21 — zamknięta doba traci `meta_purchases` i `raw_payload`

**Objaw.** Raport WCZORAJ za 19.11 (20.11 01:41) miał dla 19.11 zakupy Meta i `raw_payload`.
Raport TYDZIEŃ 14–20.11 (21.11) ma zakupy Meta tylko 20.11 („6 z 7 dób z wydatkiem bez zakupów Meta”)
i `raw_payload` w 1 z 7 dób. Obie liczby idą z tego samego `select *` na `meta_ads_daily`
(`campaign-data` → `metaCoverage`), więc zmieniły się wiersze, nie sposób liczenia.

**Źródło nadal ma wartości.** Meta Graph API zapytane 21.11 (`level=ad`, `time_increment=1`,
`7d_click,1d_view`, `action_type = purchase`):

| doba | wydatek | zakupy Meta |
|---|---|---|
| 14.11 | 526,21 | 12 |
| 15.11 | 592,26 | 11 |
| 16.11 | 588,21 | 11 |
| 17.11 | 514,04 | 3 |
| 18.11 | 552,65 | 10 |
| 19.11 | 460,78 | 9 |
| 20.11 | 480,17 | 10 |

Baza ma zera tam, gdzie Meta ma 3–12. Wartość z 19.11 była w bazie 20.11 01:41 i zniknęła — czyli
**późniejszy zapis wpisał 0 / NULL na wartość dodatnią**. W repo nic nie pisze do `meta_ads_daily`
(`src/lib/meta/insights.ts` nie jest nigdzie wywoływany), więc pisze to Make.

**Hipoteza (do potwierdzenia logiem).** Wypełniona jest tylko najnowsza doba, ta, którą ostatnio pisała
ścieżka intraday. Każda starsza doba, którą przepisuje ścieżka zamkniętej doby / catch-up, ma
jednocześnie 0 zakupów i pusty `raw_payload`. `raw_payload` nie ma w tabeli mapowania tego pliku, a
w bazie jest (od 19.11), więc scenariusz różni się od tego pliku: pole dodano w jednej ścieżce. Druga
ścieżka wysyła `meta_purchases` = 0/puste (brak akcji `purchase` w jej odpowiedzi albo brak `actions`
w jej `fields`) i `raw_payload` = puste — a PostgREST aktualizuje każdą kolumnę obecną w payloadzie.
Z tego miejsca (tylko klucz anon, RLS zwraca 0 wierszy; brak dostępu do GUI Make) nie da się odczytać
ani wierszy, ani konfiguracji modułów. Rozstrzygnie to `meta_ads_daily_guard_log` po pierwszym
przebiegu z triggerem: godzina odmów i daty wierszy pokażą, która ścieżka próbuje kasować.

**Ochrona w bazie** — `supabase/migrations/20261121_meta_ads_daily_keep_attribution.sql` (do wklejenia
ręcznie): trigger BEFORE UPDATE nie przepuszcza NULL ani mniejszej liczby w `meta_purchases` ani pustego
`raw_payload` w miejsce niepustego; odmowy idą do `meta_ads_daily_guard_log`. Test w transakcji z
rollbackiem: `supabase/tests/meta_ads_daily_keep_attribution.test.sql`. Skasowanych wartości trigger
nie przywraca — wrócą, gdy Make wyśle dla tych dób prawdziwe liczby.

### Kliknięcia w Make (dla Fifiego) i koszt operacji

Licz operacje po stronie zapisu: Make liczy 1 operację na moduł na bundle.

| # | zmiana | gdzie | operacje / przebieg |
|---|---|---|---|
| 1 | W **każdej** ścieżce (intraday i zamknięta doba / catch-up) moduł **Facebook Ads → Get Insights**: `Fields` zawiera `actions,action_values`, `Action Attribution Windows` = `7d_click, 1d_view` — tak samo jak w ścieżce, która dziś zapisuje zakupy | moduł Get Insights ścieżki zamkniętej doby | **0** (to samo jedno wywołanie, inne parametry) |
| 2 | W module **Supabase → Upsert** ścieżki zamkniętej doby zmapuj `meta_purchases` i `raw_payload` **identycznie** jak w ścieżce intraday (skopiuj formuły 1:1: suma `actions[]` z `action_type = purchase`; `raw_payload` = ten sam element co w intraday) | moduł Upsert ścieżki zamkniętej doby | **0** (zmiana mapowania, ten sam moduł, ta sama liczba bundli) |
| 3 | Zostaw w payloadzie `meta_purchases` także, gdy wynosi 0 (pkt 10 wyżej). Po triggerze zero nie skasuje już większej wartości, a pominięcie pola wymagałoby filtra/routera | — | **0** |
| ✗ | NIE dodawaj routera/filtra „pomiń wiersz bez zakupów” ani modułu „Search rows” przed zapisem — to robi trigger | — | odpowiednio +1 na bundle (filtr na routerze) lub +1 operacja na wiersz (~21/dobę catch-up, ~3 × 96 = 288/dobę intraday ≈ 8 640/mies.) — nie warto |

Razem: **0 dodatkowych operacji** na przebieg. Po zmianie: następny catch-up wpisze 14–20.11 z Meta
(liczby większe od obecnych zer przechodzą przez trigger), a
`SELECT * FROM meta_ads_daily_guard_log ORDER BY logged_at DESC` powinien przestać przybywać.
Uwaga: ten plik mówi `on_conflict = date,ad_id`, a scenariusz używa `date,campaign_id,adset_id,ad_id`
(stan podany 21.11) — trigger działa przy obu kluczach.
