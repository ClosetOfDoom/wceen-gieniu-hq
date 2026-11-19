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
- `MAILE_NIE_ODPALILY`: dzień wysyłki, po 06:45, AUTO włączone, PAUZA wyłączona, a brak śladu uruchomienia.
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
| test (`send-test`) | `contactIds: [testContactId]` i nic więcej | teraz + 31 min (minimum Wix to 30) |

- Kontakt testowy: `fundacja@wceen.com`, `testContactId = b2ccc71f-2623-4c42-8ef5-ea288c327706` (w `webinarMailConfig.js`, nie w sekretach).
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

1. **Brak `STANLEY_ACCESS_TOKEN` i tokenu Netlify na tym komputerze.** Nie dało się kliknąć „Wyślij test” we wdrożonej aplikacji ani odczytać
   Netlify Blobs (log TEST w produkcji, stan AUTO/PAUZA). Testy na żywo poszły tą samą funkcją, ale lokalnie, z logiem w pamięci.
   Deploy potwierdzony tylko po hashu w bundlu strony.
2. **Klucz Wix nie ma uprawnienia do Email Subscriptions** (`POST /email-marketing/v1/email-subscriptions` → 403). Kontakt testowy ma subskrypcję
   `NOT_SET` zamiast `SUBSCRIBED`; nie przeszkadza (4 maile dostarczone), ale nie da się tego ustawić z kodu.
3. **Na tym komputerze nie ma Node.js ani npm w PATH.** `verify` uruchomione samodzielnym Node 24 (Netlify buduje na Node 20) i npm pobranym
   do katalogu tymczasowego. Pierwszy przebieg vitest padł na starcie workera `financePanel.test.tsx` (jsdom z OneDrive ładuje się ~46 s,
   limit 60 s); po rozgrzaniu cache: zielone.
4. **Unregister SW + clear cache** wymaga przeglądarki z otwartym Stanleyem; z tej sesji niewykonalne.
5. **Czwartek 02 (`02-2026-10-29-contact-name-first…`) zablokowany**: `${contact.name.first}` jest w **temacie** (i treści), a Wix go nie podmienia.
   Temat wymaga nowego copy od autora, kod go nie zmienia. Kolejka pomija ten szablon. (Czw 01 odblokowany 19.11, patrz niżej.)
6. **Cyfry w tematach**: walidator tylko OSTRZEGA o cyfrach (blokuje „!”, tagi, „zł”, „%”). Gotowe tematy z cyframi: czw 01, czw 04,
   wt 02, wt 04 (godzina „18:00”) i wt 01 („1000 słów. 17 godzin…”). Bez nowego copy od autora tematy zostają; jeśli cyfry mają blokować, trzeba zaostrzyć
   `validateSubject` i dać nowe tematy.

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
