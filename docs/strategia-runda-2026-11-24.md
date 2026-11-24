# Runda 2026-11-24 (2): odbiorcy VALID, repo, wiedza Stanleya, zadania, brief 9:00, push, plan poczty

AUTO maili włączone (Filip), PAUZA wyłączona; runda ich nie zmieniała. Zasada danych: brak danych = „BRAK DANYCH: <źródło>”.

## P0: odbiorcy = SUBSCRIBED + VALID (deaf639)

- 24.11: 346 odbitych z 6952. Z 5854 kontaktów SUBSCRIBED (Wix Contacts, 24.11): VALID **2976**, INACTIVE 2629, BOUNCED 210, NOT_SET 33,
  SPAM_COMPLAINT 5. Nowy wybór: `subscriptionStatus = SUBSCRIBED` i `deliverabilityStatus = VALID` → **2976**. INACTIVE w Wix to adresy
  bez zaangażowania (nie odbicia), wykluczone zgodnie z poleceniem; zasięg spada mniej więcej o połowę.
- Baza bezpiecznika ODBIORCY: 2976 (limit 3273). Klient Wix sprawdza każdy zwrócony kontakt (SUBSCRIBED i VALID), bezpiecznik produkcji
  odrzuca filtr bez warunku VALID.
- Dry-run czwartek 26.11 (prawdziwy Wix, tylko odczyty): szablon `01-…-pamiec-cztery-razy-lepsza`, odbiorcy „Subskrybenci e-mail
  (SUBSCRIBED + VALID)” **2976**, ODBIORCY OK, `wouldPublish: true`.

## P1: repo prywatne — BLOKADA

- `gh` nie jest zainstalowane na tym komputerze (brak w PATH, w `Program Files\GitHub CLI` i w `AppData\Local\Programs`).
  `GET https://api.github.com/repos/ClosetOfDoom/wceen-gieniu-hq` bez logowania → HTTP 200, czyli repo **nadal publiczne**.
- Do zrobienia przez Filipa (1 min): GitHub → repo → Settings → General → Danger Zone → Change visibility → Private.
  Netlify buduje przez aplikację GitHub, która ma dostęp do prywatnych repo; po zmianie sprawdzić hash w `webinar-mail-health` po pustym commicie.
- Dopóki repo jest publiczne: pliki `stanley-wiedza/` (P2) zawierają tylko to, co Filip podał w poleceniu, bez liczb finansowych spoza kodu.

## P2: wiedza Stanleya (ca93390)

- `stanley-wiedza/`: `strategia.md` (cel 100 000 zł/mies., 6 filarów, mapowanie produktów z `productCatalog.js`: tylko pewne przypisania,
  reszta „nieprzypisane”), `filary/<slug>.md` (Opis, Model przychodu, KPI, Stan, Brakujące dane), `rytm-dnia.md` (format czytany przez kod).
  Każdy nieznany fakt jako „BRAK DANYCH: <źródło>”. Jedyna liczba w filarach: cena katalogowa WSZTP z katalogu (test to pilnuje).
- Przypisane: Języki ← language_3t, jezykozak_pack, jzk_ai, lang_3t_single, lang_3t_pdf; WSZTP ← wsztp. Nieprzypisane m.in. Pakiet Pamięciowy
  i kurs JSU (największa sprzedaż Wix): pytanie do Filipa w `strategia.md`.
- `netlify.toml` `included_files` + `stanley-wiedza/**`; `netlify/shared/stanleyKnowledge.js` (czytanie), `stanleyPillars.js` (część czysta,
  także dla przeglądarki). Q&A (`gieniu-command`) dostaje wiedzę w kontekście modelu.
- Cel przychodu (pasek postępu, nigdy alarm) 30 000 → **100 000 zł**: `GOALS.MONTHLY_REVENUE`, `MONTHLY_REVENUE_TARGET`, opis w HOME i raporcie.
  Progi alarmów (zamówienia, CPA, ROAS, kreacje) bez zmian.

## P3: zadania (81680dd)

- Magazyn w Netlify Blobs przez ten sam moduł (`createKvStore` w `webinarMailStore.js`, sklep `stanley`): `zadania/<id>`
  `{ id, tytul, filar, godzina, dzien, status }`, odhaczenia rytmu `dzien/<data>`.
- `stanley-tasks` (Functions v2, hasło): GET plan dnia, POST `command` / `toggle` / `add`.
- Q&A: „dodaj zadanie … [dziś|jutro|pojutrze|w piątek|3.12] [o 14:30] [filar …]”, „zrobione …” (zadanie albo punkt rytmu), „co dziś?”.
  Rozpoznaje je klient (`isTaskCommand`) i kieruje do `stanley-tasks`, nie do modelu.
- HOME: lista „Dziś” (rytm dnia tygodnia + zadania na dziś, bez dnia i zaległe; godziny; odhaczanie), odświeżana po każdej odpowiedzi.

## P4: brief 09:00 (9955742, poprawka 6467c76)

- `daily-brief`: funkcja harmonogramowa, cron `0 7,8 * * *`, działa tylko o 09:00 w Warszawie (07 UTC latem, 08 UTC zimą), raz na dzień
  (`brief-claim/<data>`). Liczby liczy `netlify/shared/dailyBrief.js`; model (ta sama ścieżka co Q&A, przeniesiona do `stanleyLlm.js`) pisze
  tylko 2–4 zdania wstępu, które przechodzą guard liczb z Q&A (`financeVerify.verifyNumbers`): zdanie z liczbą spoza briefu jest usuwane.
- Sekcje: 1 sprzedaż wczoraj i od 1. dnia miesiąca vs 100 000 zł (z prorata), realny CPA/ROAS blended z dopiskiem, progi 7 dób;
  2 Meta: wydatek wczoraj i 7 dób, kampanie z wydatkiem, zakupy piksela osobno, reklamy z wydatkiem i 0 zakupów przez 3 dni;
  3 maile webinarowe: ostatnia/dzisiejsza wysyłka ze statystykami Wix (w tym odbite), kolejka, odbiorcy, alarmy; 4 poczta „wymaga połączenia
  Google (etap 2)”; 5 plan dnia z godzinami; 6 alarmy, BRAK DANYCH, max 2 pytania dziennie z „Brakujące dane”.
- Sprzedaż = ta sama funkcja co `profit-data` (`profitDataFor`), bez drugiej implementacji.
- Blobs: `brief/<data>`, 14 najnowszych. `stanley-brief` (hasło): GET ostatni / `?date=` / `?list=1`, POST `{action:'dry-run'}` (nic nie zapisuje).
  HOME: karta „Brief dnia” z przyciskiem „Odsłuchaj” (ta sama ścieżka TTS co odpowiedzi).

## P5: powiadomienie push (863a83f)

- `stanleyPush.js`: para VAPID P-256 generowana przy pierwszym użyciu i trzymana w Blobs (`push/vapid`), bez zmiennych środowiskowych;
  JWT ES256 (`sub` = adres strony, bez e-maila); push bez treści, więc bez szyfrowania payloadu; subskrypcje 404/410 usuwane.
- `stanley-push` (hasło): GET klucz publiczny, POST `subscribe`, POST `test` (wysyła „Brief gotowy” od razu).
- `public/push-sw.js` (importowany przez Workbox): powiadomienie „Brief gotowy”, kliknięcie otwiera HOME. Przycisk „Włącz powiadomienia”
  w karcie briefu. iPhone: działa tylko z aplikacji dodanej do ekranu początkowego (iOS 16.4+).

## P6: plan poczty (204e303)

- `docs/brief-poczta.md`: OAuth (gmail.modify, gmail.send, calendar.readonly; klient „In production” albo Workspace „Internal”), tokeny w Blobs,
  polityka: tylko Kosz, tylko automatyczne promocje i powiadomienia, lista „NIGDY”, pierwsze 7 dni tylko etykieta `STANLEY/do-kosza`.
  Nic nie zaimplementowano.

## Dry-run briefu i blokady

- **Blokada: dry-run na danych produkcyjnych.** Klucz Supabase service role, Netlify Blobs i klucz modelu są tylko w Netlify;
  `stanley-brief` POST dry-run wymaga hasła Stanleya, którego ta sesja nie ma (konektor Netlify nie udostępnia zmiennych środowiskowych).
  Klucz anon Supabase **nie nadaje się**: RLS zwraca pustą listę zamówień zamiast błędu, co dałoby fałszywe „0 zł”.
  Lokalny dry-run na 25.11 (prawdziwy Wix, wiedza i rytm z repo) poprawnie pokazuje sekcje 1–3 jako „BRAK DANYCH: <źródło>” i wypełnia 4–6.
  Pierwszy pełny brief powstanie automatycznie 25.11 o 09:00 i będzie w karcie HOME; od razu: HOME → Stanley albo
  `POST /.netlify/functions/stanley-brief {"action":"dry-run"}` z hasłem.
- **Blokada P1**: repo publiczne (wyżej).
- Wymaga Filipa: jednorazowo „Włącz powiadomienia” na telefonie; odpowiedzi na pytania z „Brakujące dane” (wpisywać do `stanley-wiedza/filary/*.md`).
