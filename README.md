# GIENIU HQ

Operacyjny kokpit i głosowy asystent WCEEN.

## Stack

- Vite + React + TypeScript
- Supabase JS client (anon key, tylko odczyt)
- Netlify Functions (ElevenLabs TTS proxy)
- PWA (installable)

## Uruchamianie lokalnie

```bash
cd wceen-gieniu-app
npm install
cp .env.example .env   # jeśli jeszcze nie istnieje
npm run dev
```

Otwórz http://localhost:5173

## Deploy na Netlify

1. `git init && git add . && git commit -m "GIENIU HQ init"`
2. Importuj repo na Netlify (New site from Git)
3. Ustaw zmienne środowiskowe w Netlify UI:
   - `ELEVENLABS_API_KEY` — twój klucz API
   - `ELEVENLABS_VOICE_ID=CwhRBWXzGAHq8TQ4Fs17`
   - `ELEVENLABS_MODEL_ID=eleven_multilingual_v2`
   - `ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128`
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Functions directory: `netlify/functions` (ustawione w netlify.toml)

## Zmienne środowiskowe frontendu

```
VITE_SUPABASE_URL=https://phwhsteaqwrijoivqnif.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_qAWyU9LkiRwNHPGfYA6dqg_WTLSQNcc
```

Te wartości są publiczne (anon key) — mogą być w repozytorium.
ElevenLabs API key NIE trafia do frontendu — wyłącznie w Netlify env.

## Netlify Functions

| Endpoint | Metoda | Opis |
|---|---|---|
| `/.netlify/functions/eleven-tts` | POST | TTS → audio/mpeg |
| `/.netlify/functions/eleven-voices` | GET | lista głosów |
| `/.netlify/functions/eleven-voice-test` | POST | test konkretnego głosu |

## Struktura

```
src/
  brain/          personality.ts, responses.ts — logika odpowiedzi + JSU diagnosis
  components/     KPICard, CommandPanel, GieniuResponse, VoiceControls,
                  TopAds, AutomationRuns,
                  WebinarFunnelPanel, ParticipantJourneyTable
  services/       supabase.ts, data.ts, webinarFunnel.ts
  voice/          tts.ts, textClean.ts
  App.tsx         główny widok (2 zakładki: Dashboard + JSU Webinar Funnel)
  main.tsx        entry point
netlify/functions/
  eleven-tts.js, eleven-voices.js, eleven-voice-test.js
supabase/
  webinar_funnel_schema.sql  ← uruchom raz w Supabase SQL Editor
docs/
  clickmeeting_make_scenarios.md
```

---

## JSU Webinar Funnel

### Co to jest

Moduł diagnozujący lejek kursu "Jak się uczyć" (549 zł, webinar czwartek 18:00).

Porównuje kolejne etapy lejka:
```
Wysłane maile
  → Dostarczono (delivery rate)
  → Otwarcia (open rate)
  → Kliknięcia (click rate)
  → Rejestracje webinar ClickMeeting
  → Obecni na webinarze (attendance rate)
  → Zakup kursu 549 zł
  → Przychód
```

### Jak uruchomić

1. **Uruchom SQL schema** (jednorazowo):
   - Otwórz [Supabase SQL Editor](https://app.supabase.com) → twój projekt
   - Wklej i uruchom zawartość `supabase/webinar_funnel_schema.sql`
   - Tworzy tabele: `email_campaigns`, `email_recipient_events`, `webinar_sessions`, `webinar_participants`
   - Tworzy widoki: `v_webinar_jsu_funnel_by_session`, `v_webinar_jsu_participant_journey`

2. **Podłącz Make → ClickMeeting**:
   - Scenariusz 1 z `docs/clickmeeting_make_scenarios.md`
   - Wypełnia `webinar_sessions` i `webinar_participants` po każdym webinarze

3. **Podłącz Make → ESP (email)**:
   - Scenariusz 2 z `docs/clickmeeting_make_scenarios.md`
   - Wypełnia `email_campaigns` i `email_recipient_events` z webhooków MailerLite/AC

4. **Purchase matching**:
   - Scenariusz 3 (nocny cron) łączy uczestników z zamówieniami Wix po emailu

### Komendy JSU w GIENIU

Dostępne w zakładce "JSU Webinar Funnel":

| Komenda | Co robi |
|---|---|
| `webinar jak się uczyć` | Pełny raport sesji JSU |
| `czemu kurs się nie sprzedaje` | Diagnoza wąskiego gardła |
| `funnel JSU` | Ostatnie 3 sesje |
| `porównaj webinary JSU` | Tabela historyczna |
| `deliverability` | Analiza dostarczalności mailingu |
| `czy mailing siadł` | Open rate + click rate |
| `attendance rate` | Frekwencja per sesja |
| `kto był i kupił` | Tabela uczestników z purchase flag |

### Logika diagnozy (bottleneck)

Gieniu przechodzi przez lejek od góry i wskazuje **pierwszy** etap poniżej normy:

| Etap | Próg alarmu | Diagnoza |
|---|---|---|
| Delivery rate | < 85% | DELIVERABILITY — domena/lista/SPF |
| Open rate | < 15% | OPENS — temat słaby albo spam |
| Click rate | < 2% | CLICKS — CTA nie pracuje |
| Rejestracje / kliknięcia | < 5% | REGISTRATIONS — landing page |
| Attendance rate | < 60% | ATTENDANCE — przypomnienia |
| Purchase rate | < 3% | PURCHASE_PITCH — oferta/follow-up |
| Zakupy = 0, attendees > 5 | — | PRODUCT_MAPPING — sprawdź mapowanie |

### Co jest jeszcze brakujące (do podłączenia)

- [ ] Make → ClickMeeting API: scenariusz po zakończeniu sesji czwartkowej
- [ ] Make → ESP webhooks: granularne eventy email (open/click/delivered)
- [ ] Nocny cron: purchase matching uczestników z orders Wix
- [ ] Supabase RLS: grant SELECT na widokach dla anon key (jeśli potrzebne)

---

## Co zostało do modułu Command Gateway / LLM

- [ ] Netlify Function `llm-command.js` — przyjmuje komendę + kontekst Supabase, wysyła do Claude/GPT, zwraca odpowiedź
- [ ] Streaming responses (SSE) z LLM do frontendu
- [ ] Zamiana `buildXxxReport()` na wywołanie LLM z promptem systemowym Gienia
- [ ] Historia konwersacji (localStorage lub Supabase tabela `gieniu_chat`)
- [ ] Voice-to-text (Web Speech API `SpeechRecognition`) jako wejście komend
- [ ] Rate limiting i autoryzacja endpointów (np. Netlify Identity lub secret header)
