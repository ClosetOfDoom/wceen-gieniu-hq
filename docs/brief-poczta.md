# Brief: poczta i kalendarz Google (etap 2, PLAN, niewdrożone)

Stan na 2026-11-24: **nic z tego nie jest zaimplementowane.** Sekcja 4 briefu 09:00 pisze „Poczta: wymaga połączenia Google (etap 2)”.
Ten dokument opisuje, jak to zrobić, kiedy Filip zdecyduje.

## Cel

1. Brief 09:00 dostaje sekcję poczty: ile nowych maili od ludzi czeka na odpowiedź, od kogo i w jakiej sprawie (tematy, bez treści),
   oraz listę automatycznych promocji i powiadomień, które Stanley proponuje wyrzucić do Kosza.
2. Plan dnia dostaje wydarzenia z Kalendarza Google (tylko odczyt).
3. Sprzątanie poczty: wyłącznie do **Kosza** (Gmail opróżnia go po 30 dniach), nigdy trwałe usuwanie.

## Połączenie (OAuth 2.0, Google Cloud)

- Projekt Google Cloud należący do fundacji (nie prywatny), ekran zgody typu **External**, aplikacja w statusie **„In production”**.
  W statusie „Testing” refresh token wygasa po 7 dniach, a brief przestałby działać po tygodniu.
- Zakresy (scopes), tylko te trzy:
  - `https://www.googleapis.com/auth/gmail.modify`: odczyt, etykiety, przeniesienie do Kosza. **Nie** obejmuje trwałego usuwania
    (`users.messages.delete` wymaga pełnego `https://mail.google.com/`, którego nie prosimy).
  - `https://www.googleapis.com/auth/gmail.send`: wysyłanie odpowiedzi (przyszłe szkice odpowiedzi zatwierdzane przez Filipa).
  - `https://www.googleapis.com/auth/calendar.readonly`: odczyt kalendarza.
- `gmail.modify` i `gmail.send` to zakresy „restricted / sensitive”: przy aplikacji w produkcji Google wymaga weryfikacji aplikacji
  (polityka prywatności, opis użycia danych, przy restricted także ocena bezpieczeństwa). Alternatywa bez weryfikacji: konto Google Workspace
  fundacji i aplikacja typu **Internal**: wtedy weryfikacja nie jest potrzebna, a tokeny nie wygasają po 7 dniach.
- Przepływ: jednorazowo Filip klika „Połącz Google” w Stanleyu → ekran zgody Google → funkcja `google-oauth-callback` (v2, za hasłem
  w parametrze `state`) wymienia `code` na tokeny.
- **Tokeny w Netlify Blobs** (sklep `stanley`, klucz `google/tokens`), przez `createKvStore` z `webinarMailStore.js` (jedyna ścieżka do Blobs).
  Refresh token nigdy nie trafia do przeglądarki, logów ani odpowiedzi funkcji. `client_id` i `client_secret` w zmiennych środowiskowych
  Netlify (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); to jedyne nowe zmienne.
- Odwołanie dostępu: przycisk „Odłącz Google” (usuwa `google/tokens` i woła `oauth2.googleapis.com/revoke`), plus myaccount.google.com → Bezpieczeństwo.

## Polityka poczty (twarde reguły w kodzie, z testami)

**Wolno** (tylko Kosz, `users.messages.trash`, nigdy `delete`):
- automatyczne **promocje** (kategoria Gmaila `CATEGORY_PROMOTIONS`, newslettery z nagłówkiem `List-Unsubscribe`),
- automatyczne **powiadomienia** (no-reply, serwisy społecznościowe, powiadomienia aplikacji), które nie są na liście „NIGDY”.

**NIGDY** (żadnej etykiety „do-kosza”, żadnego Kosza; reguła wygrywa z każdą inną):
- maile od **ludzi** (nadawca, z którym była korespondencja, odpowiedź w wątku, brak nagłówków masowej wysyłki),
- **odpowiedzi na kampanie** (Re: do maili webinarowych i kampanii Wix, odpowiedzi subskrybentów),
- **zamówienia, płatności, faktury** (Wix Stores, Stripe, Przelewy24, PayPal, faktury i rachunki),
- **banki**,
- **urzędy**: UODO, KRS / sądy rejestrowe, urząd skarbowy (US, e-Urząd Skarbowy), ePUAP / profil zaufany, ZUS,
- **billing reklam**: Meta (Facebook / Instagram Ads) i Google (Ads, Ad Grants, Workspace, Cloud),
- **alerty bezpieczeństwa**: Wix, Netlify, Supabase, GitHub (logowania, tokeny, 2FA, zmiany uprawnień), Google (alerty konta).

Lista „NIGDY” jest w kodzie jako dopasowania nadawcy, domeny i słów w temacie; w razie wątpliwości mail zostaje (fail-safe).

## Wdrożenie stopniowe

1. **Pierwsze 7 dni: tylko etykieta.** Stanley nakłada etykietę `STANLEY/do-kosza` na kandydatów i pokazuje ich listę w briefie
   (nadawca, temat, data). Niczego nie przenosi do Kosza. Filip zdejmuje etykietę z pomyłek, a każda zdjęta etykieta staje się wyjątkiem.
2. **Po 7 dniach**, jeśli Filip potwierdzi: Stanley przenosi do Kosza wyłącznie maile z etykietą `STANLEY/do-kosza` starsze niż 24 h,
   z limitem dziennym (np. 200) i wpisem w logu (identyfikator wiadomości, nadawca, temat; bez treści).
3. Brief: „Poczta: N maili od ludzi czeka (najstarszy z <data>); M kandydatów do Kosza (lista)”. Treści maili nie trafiają do modelu.

## Bezpieczeństwo i dane

- Stanley czyta wyłącznie nagłówki (From, Subject, Date, List-Unsubscribe, etykiety), format `metadata`, bez treści, chyba że Filip
  włączy osobno szkice odpowiedzi.
- Żadnych adresów e-mail w logach Netlify i w odpowiedziach publicznych funkcji (jak dziś w health).
- Zanim powstanie kod: RODO / UODO. Dane w Gmailu fundacji to dane osobowe korespondentów; przetwarzanie przez Stanleya trzeba wpisać
  do rejestru czynności przetwarzania.
