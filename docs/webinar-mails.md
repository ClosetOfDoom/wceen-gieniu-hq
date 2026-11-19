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

Plik `webinar-mails/<slot>/NN-RRRR-MM-DD-slug.html`. Temat w `<title>`, preheader w `<meta name="preheader" content="…">`, link zapisu to `{{WEBINAR_URL}}`
(w treści zostają tagi Wix, np. `${contact.name.first}` i `{{unsubscribe}}`).

**Walidator tematu** (reputacja nadawcy na domenach WP): BLOKUJE przy „!”, tagach scalania (`${…}`, `{{…}}`) i cenach („zł”, „%”); OSTRZEGA przy innych cyfrach.
Zablokowany szablon jest pomijany w kolejce, a zakładka pokazuje jego nazwę pliku i powód.

Import z wysłanych kampanii Wix: `npm run import:webinar-templates -- --write` (bez `--write` tylko podgląd). Importuje tylko kampanie z edytora HTML.
Z podglądu Wix usuwa linki śledzące starej kampanii, stopkę wstrzykniętą przez Wix i piksel, zamienia adres zapisu na `{{WEBINAR_URL}}`.
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
  bezpiecznik odbiorców z `contacts-all` odrzuconym bez kontaktu z Wix, brak zużycia szablonu i wariantu).
- `npm run assert:webinar-mails`: struktura szablonów, zgodność crona, `included_files`, brak `publishCampaign` w funkcji admin,
  jedna ścieżka publikacji, brak Send Test, skonfigurowany kontakt testowy.
- `WEBINAR_MAIL_DRY_RUN=1` w Netlify zamienia każde uruchomienie funkcji w próbę (bez zajęcia klucza, bez kampanii, bez publikacji).
  Próbę można też zrobić przyciskiem w zakładce.

## Czego kod nie wie

- Czy `{{unsubscribe}}` w kampanii z edytora HTML jest rozwiązywane przez Wix przy wysyłce. Tak wyglądają ostatnie kampanie wysłane z dashboardu
  (m.in. dzisiejsza czwartkowa), dlatego import zamienia też starszy `[LINK WYPISANIA Z WIX]` na `{{unsubscribe}}`. Warto to potwierdzić w mailu testowym.
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
3. **`{{unsubscribe}}` z szablonu niepotwierdzony w doręczonym mailu.** W podglądzie Wix jest nadal jako `{{unsubscribe}}` (w linku śledzącym);
   skrzynka fundacja@wceen.com nie jest dostępna z tej sesji. Do sprawdzenia: otworzyć jeden z 4 testowych maili z 19.11 ~18:29 i kliknąć „wypisz”.
   Niezależnie od tego Wix dokleja własną stopkę.
4. **Na tym komputerze nie ma Node.js ani npm w PATH.** `verify` uruchomione samodzielnym Node 24 (Netlify buduje na Node 20) i npm pobranym
   do katalogu tymczasowego. Pierwszy przebieg vitest padł na starcie workera `financePanel.test.tsx` (jsdom z OneDrive ładuje się ~46 s,
   limit 60 s); po rozgrzaniu cache: zielone.
5. **Unregister SW + clear cache** wymaga przeglądarki z otwartym Stanleyem; z tej sesji niewykonalne.
6. Czwartkowy szablon `02-2026-10-29-contact-name-first…` jest zablokowany przez walidator tematu (tag scalania) i pomijany w kolejce: do poprawy tematu.
