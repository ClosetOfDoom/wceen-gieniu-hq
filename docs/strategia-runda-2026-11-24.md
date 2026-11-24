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
