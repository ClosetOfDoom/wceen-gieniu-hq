# Maile webinarowe (automat)

Wtorek: webinar językowy, czwartek: webinar pamięciowy, oba o 18:00. Zakładka **Maile webinarowe** w Stanleyu.

## Jak to działa

1. `webinar-mail-run` (funkcja zaplanowana, cron `0 4,5 * * 2,4` UTC) budzi się we wtorek i czwartek o 04:00 i 05:00 UTC.
   O 06:00 czasu warszawskiego pracuje tylko jedno z tych uruchomień: latem (CEST) 04:00 UTC, zimą (CET) 05:00 UTC.
   Drugie kończy się od razu (`not-wake-hour`). Jeden wyraz cron z dwiema godzinami zastępuje „dwa crony”: Netlify daje jeden harmonogram na funkcję.
2. Bierze **następny niewysłany, poprawny szablon** slotu z `webinar-mails/<slot>/` (kolejność po nazwie pliku, bez zawijania).
3. Wybiera wariant linku zapisu: naprzemiennie `landing` i `clickmeeting` (osobno dla każdego slotu).
4. Sprawdza bezpieczniki (każdy osobno, wszystkie wyniki w raporcie): konto Wix `ACTIVE`, temat obecny i poprawny, link zapisu zwraca HTTP 200,
   dziś nie ma już kampanii tego webinaru (lista kampanii Wix + podgląd), PAUZA wyłączona, do 07:00 zostało ≥ 30 minut.
5. Zajmuje klucz `<data>-<slot>` (idempotencja, zapis `onlyIfNew` w Blobs), tworzy kampanię (edytor HTML) i publikuje ją z `sendAt` 07:00 czasu warszawskiego
   do etykiety `contacts-all` (wszystkie kontakty Wix, `activeContactsOnly: false`: tak jak dotychczasowe kampanie webinarowe).

**AUTO** i **PAUZA** są w zakładce (stan w Netlify Blobs, sklep `webinar-mail`). Domyślnie AUTO jest wyłączone: nic nie wychodzi, dopóki ktoś go nie włączy.
AUTO wyłączone, PAUZA i `skipDates` (2026-12-24, 2026-12-31) to stany celowe: bez alarmu, bez zużycia szablonu.

## Alarmy (czerwone, widoczne w zakładce i w „Alarmy · pełne doby” na Command Center)

- `MAILE_AWARIA`: ostatnie uruchomienie nie przeszło (bezpiecznik, błąd publikacji, wyjątek, pusta kolejka). Znika po kolejnym udanym biegu albo po „Przyjąłem do wiadomości”.
- `MAILE_NIE_ODPALILY`: dzień wysyłki, po 06:45, AUTO włączone **przed** planowym uruchomieniem tego dnia (06:00 Warszawa), PAUZA wyłączona,
  a brak śladu uruchomienia. Czas włączenia to `state.autoChangedAt` (zapisywany przy każdej zmianie AUTO); stan sprzed tej poprawki
  używa `autoChangedAtFallback` = wdrożenie T2 (2026-11-19T23:01Z). AUTO włączone po 06:00 nie daje alarmu za ten dzień.
- `MAILE_KOLEJKA_PUSTA` (czerwony) i `MAILE_KOLEJKA_NISKA` (bursztynowy, ≤ 3 gotowych szablonów).

## Szablony

Plik `webinar-mails/<slot>/NN-RRRR-MM-DD-slug.html`. Temat w `<title>`, preheader w `<meta name="preheader" content="…">`, link zapisu to `{{WEBINAR_URL}}`.
To **jedyny** znacznik w szablonie: Wix w kampanii z edytora HTML nie podmienia ani `{{unsubscribe}}`, ani `${contact.name.first}` (oba docierają surowe,
sprawdzone 19.11.2026: ręczny mail z 09:07Z miał martwy link `href="{{unsubscribe}}"`, podgląd testu czw 01 ma surowe `${contact.name.first}`).

**Wix dokleja stopkę z wypisaniem, własny link zbędny.** Szablony nie mają własnego linku „Wypisz się”; zdanie
„Dostajesz tę wiadomość, bo zapisałeś się…” zostaje. 19.11.2026 usunięto po jednym `<a href="{{unsubscribe}}">` z 7 szablonów
(wt 01–04, czw 01, 03, 05; czw 02 i 04 go nie miały). Import (`removeOwnUnsubscribeLinks`) usuwa taki link, zamiast go przenosić.

**Jeden render**: `renderCampaignHtml(html, url)` podmienia `{{WEBINAR_URL}}` i zwraca `{ html, unresolved }`. Z niego korzystają walidator szablonu,
`webinar-mail-run` i „Wyślij test”. Każdy znacznik `{{…}}` albo `${…}`, który przetrwa render, BLOKUJE wysyłkę:
walidator odrzuca szablon (kolejka go pomija, szablon nie jest zużywany), bezpiecznik `ZNACZNIKI_ROZWIAZANE` w biegu (czerwony `MAILE_AWARIA`),
a `createAndPublish` odmawia przed jakimkolwiek wywołaniem Wix (test i produkcja).

**Walidator tematu** (reputacja nadawcy na domenach WP): BLOKUJE przy „!”, tagach scalania (`${…}`, `{{…}}`) i cenach („zł”, „%”); OSTRZEGA przy innych cyfrach.
Zablokowany szablon jest pomijany w kolejce, a zakładka pokazuje jego nazwę pliku i powód.

Import z wysłanych kampanii Wix: `npm run import:webinar-templates -- --write` (bez `--write` tylko podgląd). Importuje tylko kampanie z edytora HTML.
Z podglądu Wix usuwa linki śledzące starej kampanii, stopkę wstrzykniętą przez Wix, piksel i własny link wypisania, zamienia adres zapisu na `{{WEBINAR_URL}}`.
Nie nadpisuje istniejących plików.

## „Wyślij test” = ta sama ścieżka co produkcja

Wix „Send Test Email” (`/campaigns/{id}/test`) nie jest używany nigdzie w kodzie (dawał 403/429). Przycisk „Wyślij test” w zakładce
wywołuje `send-test` w `webinar-mail-admin`, które idzie przez **tę samą funkcję** `createAndPublish` co `webinar-mail-run`
(Create Campaign z edytora HTML + Publish z `emailDistributionOptions`). Różni je tylko lista odbiorców:

| | odbiorcy | sendAt |
|---|---|---|
| produkcja (`webinar-mail-run`) | `labelIds: ['contacts-all']`, `activeContactsOnly: false` | 07:00 Warszawa |
| test (`send-test`) | `contactIds: [testContactId]` i nic więcej | teraz + 31 min (minimum Wix to 30; bez `sendAt` Wix daje 403, blokada 7) |

- Kontakt testowy (od 2026-11-20): `fundacjawceen@gmail.com`, `testContactId = df6fa121-fe39-426b-bc1b-fc8734bd0812` (istniejący kontakt Wix,
  ten adres jest jego **głównym** e-mailem, subskrypcja `SUBSCRIBED`, doręczalność `VALID`; w `webinarMailConfig.js`, nie w sekretach).
  Wcześniej: `fundacja@wceen.com` (`b2ccc71f-…`).
- **Bezpiecznik** `assertTestAudience`: przed jakimkolwiek wywołaniem Wix odrzuca każdą listę inną niż dokładnie `{ contactIds: [testContactId] }`:
  etykietę (w tym `contacts-all`), segment, `activeContactsOnly`, inny lub dodatkowy kontakt. Wywołujący nie wybiera odbiorców.
- Test **nie zużywa szablonu** i **nie liczy się do naprzemiennych wariantów linku**: wpis w logu ma `test: true`, status `test`, klucz `TEST-<data>-<slot>-<wariant>`.
- Opcjonalnie `variant: 'landing' | 'clickmeeting'` (domyślnie następny wariant slotu), żeby sprawdzić oba linki.
- `npm run assert:webinar-mails` pilnuje: jedno `wix.publishCampaign` w kodzie (w `createAndPublish`), test tylko przez `createAndPublish({ test: true })`, zero wywołań Send Test.

## Wysyłki i rejestracje

Tabela w zakładce: data, slot, wariant, status, temat, CTR z Wix (unikalne kliknięcia / dostarczone), pole na ręczny wpis liczby rejestracji z ClickMeeting.

## Testy

- `src/lib/__tests__/webinarMail.test.ts` (Vitest): 06:00 Warszawa w CET i CEST, sendAt 07:00, idempotencja, AUTO OFF / PAUZA / skipDates, każdy bezpiecznik osobno,
  walidator tematu, naprzemienne warianty, pusta kolejka, DRY_RUN end-to-end, payloady Wix, ścieżka testowa (ten sam create+publish,
  bezpiecznik odbiorców z `contacts-all` odrzuconym bez kontaktu z Wix, brak zużycia szablonu i wariantu), nierozwiązane znaczniki
  (szablon z `{{unsubscribe}}` odrzucony, ten sam bez niego przechodzi, `{{X}}` / `${…}` blokuje walidator, bezpiecznik, test i produkcję).
- `npm run assert:webinar-mails`: struktura szablonów, zgodność crona, `included_files`, brak `publishCampaign` w funkcji admin,
  jedna ścieżka publikacji, brak Send Test, skonfigurowany kontakt testowy, zero `{{unsubscribe}}` w szablonach,
  każdy gotowy szablon renderuje się bez `{{…}}` i `${…}`.
- `WEBINAR_MAIL_DRY_RUN=1` w Netlify zamienia każde uruchomienie funkcji w próbę (bez zajęcia klucza, bez kampanii, bez publikacji).
  Próbę można też zrobić przyciskiem w zakładce.

## Czego kod nie wie

- Preheadera nie da się odczytać z wysłanych kampanii przez API (lista i podgląd go nie zwracają), więc zaimportowane szablony mają pusty preheader.

## Stan na 2026-11-19 (wieczór)

- Kod: „Wyślij test” przerobiony na Publish do jednego `contactId` (sekcja wyżej). `npm run verify`: zielone (26 plików testów, 638 testów, wszystkie asserty).
- Kontakt testowy `fundacja@wceen.com` utworzony w Wix: `contactId b2ccc71f-2623-4c42-8ef5-ea288c327706`, subskrypcja `NOT_SET` (nie wypisany).
- **4 testowe publikacje na żywo** (tą samą funkcją `adminAction('send-test')` → `createAndPublish`, prawdziwy klient Wix, log w pamięci),
  zaplanowane 16:56Z na `sendAt 2026-11-19T17:28:00Z`, wysłane 17:29Z:

  | slot | wariant | szablon | campaignId | status Wix | dostarczone |
  |---|---|---|---|---|---|
  | wtorek | landing | 01-2026-10-20-1000-slow-17-godzin-zero-wkuwania | f10a7f6f-9a06-4133-8903-aa2b8605dc0a | DISTRIBUTED | 1 |
  | wtorek | clickmeeting | 01-2026-10-20-1000-slow-17-godzin-zero-wkuwania | fc98315b-b8c3-46e6-9451-e879d6758a62 | DISTRIBUTED | 1 |
  | czwartek | landing | 01-2026-10-20-dzis-o-18-00-pamiec-cztery-razy-lepsza | cb81f211-215c-4ed6-bdb0-3f5fa9378e8e | DISTRIBUTED | 1 |
  | czwartek | clickmeeting | 01-2026-10-20-dzis-o-18-00-pamiec-cztery-razy-lepsza | 5de97931-f334-4c67-b395-12a50a46ecbc | DISTRIBUTED | 1 |

  Statystyki Wix dla każdej: delivered 1, bounced 0, notSent 0; lista odbiorców (DELIVERED) = 1, to kontakt testowy.
  W wyrenderowanym HTML (podgląd Wix): `{{WEBINAR_URL}}` podmieniony, link prowadzi wyłącznie do wybranego wariantu, każdy z 4 adresów zwraca HTTP 200,
  Wix dokleja swoją stopkę („Ta wiadomość e-mail została wysłana z…”).
- **Dry-run `webinar-mail-run` na wtorek 24.11, 06:00 Warszawa** (prawdziwy Wix i sprawdzenie linku, log z 4 wpisami TEST):
  szablon `01-2026-10-20-1000-slow-17-godzin-zero-wkuwania.html` („1000 słów. 17 godzin. zero wkuwania”), wariant `landing`
  (https://www.wceen.com/webinar-jezyk-w-17h), `sendAt 2026-11-24T06:00:00Z` = 07:00 Warszawa, gotowych szablonów 4 (testy nic nie zużyły).
  Bezpieczniki: KONTO_ACTIVE, TEMAT, LINK_200, BRAK_WYSYLKI_DZIS, PAUZA_WYLACZONA, SENDAT_W_PRZYSZLOSCI (60 min): wszystkie OK.
  Bramka `AUTO_OFF` → `wouldPublish: false`. **AUTO pozostaje WYŁĄCZONE** (włącza je Filip w zakładce).

## Blokady

1. **Brak `STANLEY_ACCESS_TOKEN` i tokenu Netlify na tym komputerze.** Nie da się kliknąć „Wyślij test” we wdrożonej aplikacji ani zobaczyć
   zakładki MAILE z danymi. Od 19.11 (P2) odczyt Blobs w produkcji jest dowodzony bez tokenu przez publiczny `webinar-mail-health`
   (`blobsRead: "ok"`, AUTO/PAUZA, kolejki); pełny GET `webinar-mail-admin` z hasłem nadal niesprawdzony z tej sesji.
2. **Klucz Wix nie ma uprawnienia do Email Subscriptions** (`POST /email-marketing/v1/email-subscriptions` → 403). Kontakt testowy ma subskrypcję
   `NOT_SET` zamiast `SUBSCRIBED`; nie przeszkadza (4 maile dostarczone), ale nie da się tego ustawić z kodu.
3. **Na tym komputerze nie ma Node.js ani npm w PATH.** `verify` uruchomione samodzielnym Node 24 (Netlify buduje na Node 20) i npm pobranym
   do katalogu tymczasowego. Pierwszy przebieg vitest padł na starcie workera `financePanel.test.tsx` (jsdom z OneDrive ładuje się ~46 s,
   limit 60 s); po rozgrzaniu cache: zielone.
4. **Unregister SW + clear cache** wymaga przeglądarki z otwartym Stanleyem; z tej sesji niewykonalne. Potrzebne **ostatni raz** (po deployu
   e70d5b5): stary bundel nie ma jeszcze sprawdzania `/version.json`. Od P5 aplikacja sama się przeładowuje przy nowym buildzie.
5. **Czwartek 02 (`02-2026-10-29-contact-name-first…`) zablokowany**: `${contact.name.first}` jest w **temacie** (i treści), a Wix go nie podmienia.
   Temat wymaga nowego copy od autora, kod go nie zmienia. Kolejka pomija ten szablon. (Czw 01 odblokowany 19.11, patrz niżej.)
6. **Cyfry w tematach**: walidator tylko OSTRZEGA o cyfrach (blokuje „!”, tagi, „zł”, „%”). Gotowe tematy z cyframi: czw 01, czw 04,
   wt 02, wt 04 (godzina „18:00”) i wt 01 („1000 słów. 17 godzin…”). Bez nowego copy od autora tematy zostają; jeśli cyfry mają blokować, trzeba zaostrzyć
   `validateSubject` i dać nowe tematy.
7. **Test nie może wyjść natychmiast.** Publish bez `sendAt` (ta sama `createAndPublish`, tylko kontakt testowy) Wix odrzuca:
   `POST /email-marketing/v1/campaigns/{id}/publish` → **HTTP 403** z pustym `message` (19.11 ok. 22:51Z, dwa razy na tym samym szkicu;
   szkic `0b6f5e46…` skasowany, nie ma go już na liście szkiców). Test zostaje z `sendAt` = teraz + 31 min. `createAndPublish` odmawia
   każdej publikacji bez poprawnego `sendAt` (test i produkcja) przed wywołaniem Wix (`BEZPIECZNIK WYSYŁKI`).
8. **Test z T3 nie jest w logu produkcji.** Prawdziwy test T3 szedł z tej sesji (klucz Wix z `.env.local`, log w pamięci), bo nie ma tu hasła
   do `webinar-mail-admin` (blokada 1). Kampania jest w Wix; w `webinar-mail-health` → `ostatnieWpisy` są tylko testy kliknięte w aplikacji.
9. **Nadawca zależny od slotu (wtorek „Filip Dąbrowski”, czwartek „Marek Szurawski”) NIEWDROŻONY: klucz API „STANLEY” nie ma uprawnienia
   do Sender Details API.** 2026-11-19 ok. 23:17Z (20.11 00:17 Warszawa): `GET https://www.wixapis.com/sender-details/v1/sender-details` → **HTTP 403** (pusty `message`),
   `GET …/sender-details/v1/sender-details/default` → **HTTP 403**. Wszystkie metody tego API (List, Get Default, Create, Mark as Default)
   wymagają według dokumentacji Wix uprawnienia:

   **„Access Verticals by Automations” (`SCOPE.CRM.ACCESS-VERTICALS-BY-AUTOMATIONS`)**

   Do zrobienia przez właściciela konta: Wix → API Keys Manager → klucz „STANLEY” → dodać to uprawnienie dla witryny. Potem kod może
   przełączać domyślnego nadawcę przed publikacją (Campaign API publikuje tylko od nadawcy domyślnego). Jeśli po dodaniu uprawnienia nadal
   będzie 403, to Wix nie przyjmuje tu tożsamości klucza API (wtedy zostaje ręczna zmiana nazwy nadawcy w panelu).
   Plan: konto `ACTIVE`, pakiet `EmailMarketing_Unlimited`. Drugi nadawca wymaga planu Core lub Advanced; czy ten pakiet go obejmuje,
   pokaże dopiero Create Sender Details (błąd `OVER_QUOTA`, jeśli nie). W wysyłce nic nie zmieniono.
   **Stan teraz** (stary odczyt `GET /email-marketing/v1/sender-details`, działa): nadawca „Marek Szurawski”, adres Gmail fundacji
   (ten sam co nowy kontakt testowy). Listy wszystkich nadawców i flagi „domyślny” bez nowego API nie da się odczytać.
   **Skutek: wtorek 24.11 07:00 wyjdzie jako „Marek Szurawski”**, chyba że przed 07:00 ktoś zmieni nazwę nadawcy w panelu Wix
   (Email Marketing → ustawienia nadawcy) albo doda uprawnienie (wtedy trzeba wdrożyć przełączanie).

## Stan na 2026-11-19 (noc): martwy link wypisania

- Usunięte `<a href="{{unsubscribe}}">…Wypisz się…</a>`: wt 01, 02, 03, 04 i czw 01, 03, 05: po 1 (razem 7); czw 02, 04: 0. W `{{unsubscribe}}` nie ma już żadnego szablonu.
- Dry-run `webinar-mail-run` na wtorek 24.11 06:00 (prawdziwy Wix): szablon `01-2026-10-20-1000-slow-17-godzin-zero-wkuwania.html`, wariant `landing`,
  `sendAt 2026-11-24T06:00:00Z`; bezpieczniki KONTO_ACTIVE, TEMAT, LINK_200, BRAK_WYSYLKI_DZIS, PAUZA_WYLACZONA, ZNACZNIKI_ROZWIAZANE, SENDAT_W_PRZYSZLOSCI: OK;
  bramka AUTO_OFF (`wouldPublish: false`). Finalny HTML: 0 × `{{`, 0 × `${`; 4 linki `<a>`: 3 × `www.wceen.com` (link zapisu), 1 × `mailto:` (wceen.com).

## Stan na 2026-11-19 (noc, 2): czwartek 01 odblokowany

- `thursday/01-2026-10-20-dzis-o-18-00-pamiec-cztery-razy-lepsza.html`: `${contact.name.first}` było tylko w treści (linia 33, samodzielne powitanie
  przed akapitem „przez czterdzieści lat…”); temat i preheader bez tagu. Zamienione na „Cześć,”; reszta bez zmian.
- Walidator: `blocked: []`; render obu wariantów: 0 × `{{`, 0 × `${`.
- Kolejki: wtorek 4 gotowe / 0 zablokowanych, czwartek 4 gotowe / 1 zablokowany (02). `MAILE_KOLEJKA_NISKA` (≤ 3) gaśnie w czwartku.
- Dry-run `webinar-mail-run` na czwartek 26.11 05:00Z (prawdziwy Wix): szablon czw 01, wariant `landing` (`www.wceen.com/darmowy-webinar`),
  `sendAt 2026-11-26T06:00:00Z` = 07:00 Warszawa; wszystkie 7 bezpieczników OK; bramka AUTO_OFF (`wouldPublish: false`).
  Finalny HTML: 0 × `{{`, 0 × `${`; 4 linki `<a>`: 3 × `www.wceen.com/darmowy-webinar`, 1 × `mailto:` (wceen.com).

## Stan na 2026-11-19 (noc, 3): HTTP 500 w MAILE, health, zakładki, samoaktualizacja

- **P1 (9a9a133)**: `webinar-mail-admin` przeniesiony na Functions API v2 (`export default withStanleyAuthV2(...)`). Przyczyna 500:
  handler v1 z `connectLambda` nie miał `uncachedEdgeURL`, więc odczyt Blobs ze `consistency: 'strong'` padał. KROK 0: Blobs używały tylko
  `webinar-mail-admin` (v1) i `webinar-mail-run` (v2), obie przez `createBlobStore()`. Teraz `@netlify/blobs` importuje wyłącznie
  `netlify/shared/webinarMailStore.js`, a każda funkcja ze store jest v2 (assert w `assert:webinar-mails`). Hasło: ta sama `checkAccess`.
- **P2 (90354d0)**: publiczny `GET /.netlify/functions/webinar-mail-health` (v2, tylko odczyt, na liście wyjątków `assert:stanley-auth`).
  Zwraca wyłącznie `{ build, blobsRead, auto, pauza, kolejka: { wtorek, czwartek }, nastepnaWysylka }`. Hash builda z `dist/version.json`
  (pisany przez `vite build`, dołączony do funkcji przez `included_files`). Produkcja: HTTP 200, `blobsRead: "ok"`; admin bez tokenu: 401.
- **P3 (977367f)**: teksty o stanie bazy liczone z wierszy (`src/lib/metaCoverage.ts`): ostrzeżenie „Purch.” w CAMPAIGNS, notka
  `meta_purchases` w raporcie COPY, odmowy reguł CZĘSTOTLIWOŚĆ / KLIK_DO_KASY (bez „kolumna istnieje od migracji 2026-10-03”).
- **P4 (98065c5)**: zakładki FUNDING i SYNC usunięte; lista przebiegów Make przeniesiona do STATUS → Automation. Nagłówek i dolny pasek
  mieszczą się przy 360 i 390 px: `npm run check:responsive` (Playwright, build produkcyjny, każda zakładka).
- **P5 (e70d5b5)**: `src/lib/buildVersion.ts`: przy starcie i powrocie do karty porównanie `/version.json` z `__BUILD_HASH__`,
  przy różnicy aktualizacja SW i jedno przeładowanie (bezpiecznik w `sessionStorage`). SW: `skipWaiting` + `clientsClaim` (workbox).
- `verify`: 27 plików testów, 639 testów, wszystkie asserty zielone (mniej testów niż 644, bo usunięto testy radaru dotacji razem z zakładką).

Nowe blokady i uwagi z tej rundy:

- **Playwright bez danych z funkcji**: brak hasła lokalnie, więc wywołania `/.netlify/functions/*` w teście dostają 503; panele CAMPAIGNS,
  WEBINARS, MAILE są mierzone w stanie „brak danych”. HOME czyta Supabase bezpośrednio i ma prawdziwe dane. Szerokie tabele z danymi
  z funkcji nie były mierzone. Na mobile `html, body` mają `overflow-x: hidden` (od dawna), co może maskować przepełnienie w `scrollWidth`.
- **Edge headless nie startuje pod Playwright** na tym komputerze; test używa Chromium Playwrighta (`PW_CHANNEL=chromium`,
  `node node_modules/playwright/cli.js install chromium`).
- **`assert-campaigns` pada** (`campaignDiagnosis.ts does not query meta_ads_daily`) już przed tą rundą; nie jest w `verify`, nie ruszane.
- `META_PURCHASES_FIXED_ON` w `src/lib/orderWindow.ts` zostaje `null` (to bramka metryk, nie tekst); teksty już go nie używają.

## Stan na 2026-11-19 (noc, 4): statusy testów, fałszywy alarm, test od razu, health z alarmami

AUTO włączone przez Filipa 19.11 ok. 22:38Z; ta runda nie zmieniała AUTO ani PAUZY.

- **T1 (62ab17c)**: KROK 0: ścieżka testowa zapisuje `status: 'test'` (błąd: `'test-failed'`), `test: true`, klucz `TEST-…`. Panel mapował wszystko
  poza `'scheduled'` na „błąd” (stąd dwa testy z 19.11 22:39Z / 22:40Z jako „błąd”). Teraz jedna lista: `netlify/shared/webinarMailStatus.js`
  (`LOG_STATUSES`, `isTestEntry`, `isProductionSend`, `sendStatusView` → zaplanowany / wysłany / błąd), używana przez kolejkę, wariant linku,
  idempotencję slotu, pobieranie CTR i zakładkę. Testy w osobnej sekcji „Testy” z oznaczeniem TEST, bez CTR i bez wpływu na A/B.
  `assert:webinar-mails` odrzuca ręczne porównania statusów wpisów.
- **T2 (85a604f)**: `autoChangedAt` w stanie; `MAILE_NIE_ODPALILY` tylko gdy AUTO było włączone przed 06:00 danego dnia (sekcja Alarmy).
  Testy: włączenie 19.11 22:38Z → brak alarmu za 19.11; włączenie w poniedziałek → alarm we wtorek po 06:45 bez śladu biegu.
- **T3 (1a8b768)**: publikacja testu bez `sendAt` odrzucona przez Wix (blokada 7), więc zostaje +31 min. Twardy bezpiecznik `sendAt`,
  poprawiony tekst okna potwierdzenia („mail wyjdzie za ok. 31 min: Wix nie przyjmuje wysyłki natychmiastowej”).
- **T4 (dab5bd6)**: `webinar-mail-health` ma też `alarmy` (kody aktywnych alarmów, te same reguły co zakładka) i `ostatnieWpisy`
  (max 5: `{ data, slot, status, test }`, bez ID kampanii, tematów, plików i e-maili).

## Stan na 2026-11-20: nadawca zależny od slotu, kontakt testowy

- KROK 0 (Sender Details API): **403** dla klucza „STANLEY” (blokada 9, z nazwą uprawnienia). Zgodnie z poleceniem nic w wysyłce nie zmieniono:
  bez konfiguracji `fromName` per slot, bez przełączania domyślnego nadawcy, bez alarmu `NADAWCA_NIE_USTAWIONY`, bez pól nadawców w health
  (bez dostępu do API byłyby nieprawdziwe).
- Kontakt testowy zmieniony na `fundacjawceen@gmail.com` (`df6fa121-…`, istniejący kontakt, adres główny). Twardy bezpiecznik jednego kontaktu
  (`assertTestAudience`) bez zmian; etykieta przycisku bierze adres z konfiguracji („Wyślij test na fundacjawceen@gmail.com”).
