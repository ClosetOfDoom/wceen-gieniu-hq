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

## Wysyłki i rejestracje

Tabela w zakładce: data, slot, wariant, status, temat, CTR z Wix (unikalne kliknięcia / dostarczone), pole na ręczny wpis liczby rejestracji z ClickMeeting.

## Testy

- `src/lib/__tests__/webinarMail.test.ts` (Vitest): 06:00 Warszawa w CET i CEST, sendAt 07:00, idempotencja, AUTO OFF / PAUZA / skipDates, każdy bezpiecznik osobno,
  walidator tematu, naprzemienne warianty, pusta kolejka, DRY_RUN end-to-end, payloady Wix.
- `npm run assert:webinar-mails`: struktura szablonów, zgodność crona, `included_files`, brak `publishCampaign` w funkcji admin.
- `WEBINAR_MAIL_DRY_RUN=1` w Netlify zamienia każde uruchomienie funkcji w próbę (bez zajęcia klucza, bez kampanii, bez publikacji).
  Próbę można też zrobić przyciskiem w zakładce.

## Czego kod nie wie

- Czy `{{unsubscribe}}` w kampanii z edytora HTML jest rozwiązywane przez Wix przy wysyłce. Tak wyglądają ostatnie kampanie wysłane z dashboardu
  (m.in. dzisiejsza czwartkowa), dlatego import zamienia też starszy `[LINK WYPISANIA Z WIX]` na `{{unsubscribe}}`. Warto to potwierdzić w mailu testowym.
- Preheadera nie da się odczytać z wysłanych kampanii przez API (lista i podgląd go nie zwracają), więc zaimportowane szablony mają pusty preheader.
