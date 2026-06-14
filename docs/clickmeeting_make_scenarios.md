# ClickMeeting + Email → Supabase — Make scenarios

Instrukcja podłączenia danych webinarowych JSU do Supabase.  
Wszystkie scenariusze są **addytywne** — nie modyfikują istniejących tabel.

---

## Scenariusz 1: ClickMeeting sessions → Supabase

### Trigger
Webhook ClickMeeting `conference_ended` LUB Scheduled (cron co 15 min po każdym czwartku 18:00).

### Cel
Upsert webinar session i uczestników do Supabase.

### Kroki Make

```
1. ClickMeeting — List conferences (filter: status=ended, product_tag=JSU)
2. Supabase — Upsert row → webinar_sessions
   Pola:
     clickmeeting_room_id  = conference.id          (string)
     session_name          = conference.name         (string)
     product_tag           = "JSU"                   (literal)
     scheduled_at          = conference.starts_at    (ISO 8601, Warsaw timezone)
     ended_at              = conference.ends_at      (ISO 8601)
     registered_count      = conference.registrations_count (int, fallback 0)
     attendee_count        = conference.attendees_count     (int, fallback 0)
   Conflict: ON CONFLICT (clickmeeting_room_id, scheduled_at) DO UPDATE

3. ClickMeeting — List registrants for conference (conference_id)
4. For each registrant:
   Supabase — Upsert row → webinar_participants
   Pola:
     session_id     = <uuid from step 2 output>
     email          = registrant.email            (text, lowercase)
     registered_at  = registrant.created_at       (timestamptz)
     attended       = registrant.attended          (boolean)
     attend_duration_min = registrant.duration_minutes (int, fallback null)
   Conflict: ON CONFLICT (session_id, email) DO UPDATE
```

### Purchase matching (krok 5)
Po upsert uczestnika sprawdź w `orders` Supabase czy istnieje zamówienie pasujące emailem w oknie 7 dni po webinarze:

```
5. Supabase — Select from orders
   WHERE customer_email = participant.email
     AND product_name ILIKE '%jak się uczyć%'
     AND created_at BETWEEN session.scheduled_at AND session.scheduled_at + INTERVAL '7 days'
   LIMIT 1

6. Jeśli znaleziono:
   Supabase — Update webinar_participants
   SET purchased_at   = order.created_at
       purchase_value = order.total_price
       wix_order_id   = order.id
   WHERE id = participant_id
```

### Wymagane pola z ClickMeeting API
| Pole | Źródło |
|---|---|
| `conference.id` | `GET /conferences` |
| `conference.starts_at` | ISO 8601 |
| `conference.registrations_count` | `GET /conferences/{id}/registrations` |
| `conference.attendees_count` | `GET /conferences/{id}/attendees` |
| `registrant.email` | `GET /conferences/{id}/registrations` |
| `registrant.attended` | derived from attendees list |
| `registrant.duration_minutes` | `GET /conferences/{id}/attendees` |

---

## Scenariusz 2: ESP Email Events → Supabase

Obsługiwany ESP: MailerLite / ActiveCampaign / własny SMTP z webhookami.

### Trigger
Webhook ESP na zdarzeniu: `sent`, `delivered`, `open`, `click`, `bounce`, `unsubscribe`.

### Cel
Zapis kampanii JSU i granularnych eventów do Supabase.

### Krok 2a: Nowa kampania (przed wysyłką lub tuż po)

```
Supabase — Insert → email_campaigns
Pola:
  campaign_name   = campaign.subject (text)
  subject         = campaign.subject (text)
  sent_at         = NOW() in Europe/Warsaw
  product_tag     = "JSU"
  list_segment    = "buyers_PP" | "all_active" | etc.
  total_sent      = campaign.recipient_count (int)
  total_delivered = 0  (aktualizowane przez webhook)
```

### Krok 2b: Zdarzenie per-odbiorca (webhook)

```
Supabase — Upsert → email_recipient_events
Pola:
  campaign_id  = <uuid z email_campaigns dla tej kampanii>
  email        = event.subscriber.email
  event_type   = event.type  ('sent'|'delivered'|'open'|'click'|'bounce'|'unsubscribe')
  occurred_at  = event.timestamp (ISO 8601)
  metadata     = { url: event.url, device: event.device }  (jsonb, opcjonalne)
```

### Krok 2c: Aktualizacja total_delivered

```
Po zebraniu delivered events (np. 15 min po wysyłce):
Supabase — Update email_campaigns
SET total_delivered = (
  SELECT COUNT(DISTINCT email)
  FROM email_recipient_events
  WHERE campaign_id = this_campaign_id
    AND event_type = 'delivered'
)
WHERE id = this_campaign_id
```

### MailerLite webhook mapping
| Make pole | MailerLite webhook field |
|---|---|
| `event.type` | `data.type` |
| `event.subscriber.email` | `data.subscriber.email` |
| `event.timestamp` | `data.timestamp` |
| `event.url` | `data.fields.url` (click events) |

### ActiveCampaign webhook mapping
| Make pole | AC field |
|---|---|
| `event.type` | `type` (open/click/etc.) |
| `event.subscriber.email` | `contact[email]` |
| `event.timestamp` | `date_time` |

---

## Scenariusz 3: Purchase matching z istniejącej tabeli `orders`

Jeśli nie chcesz duplikować logiki w scenariuszu 1, możesz uruchamiać osobny scenariusz nocny:

```
Trigger: Scheduled — codziennie o 03:00

1. Supabase — Select webinar_participants
   WHERE purchased_at IS NULL
     AND attended = true
     AND session.product_tag = 'JSU'

2. For each participant:
   Supabase — Select orders
   WHERE customer_email = participant.email
     AND (product_name ILIKE '%jak się uczyć%' OR product_price = 549)
     AND created_at > participant.registered_at
     AND created_at < participant.registered_at + INTERVAL '14 days'
   LIMIT 1

3. If found:
   Supabase — Update webinar_participants
   SET purchased_at   = order.created_at,
       purchase_value = order.total_price,
       wix_order_id   = order.id
```

---

## Wymagane pola tabeli `orders` (istniejąca)

Scenariusz zakłada, że `orders` ma co najmniej:
- `customer_email` (text)
- `product_name` (text) zawierające "jak się uczyć" lub cena 549
- `total_price` (numeric)
- `created_at` (timestamptz)
- `id` (text lub uuid)

Jeśli kolumny mają inne nazwy — dostosuj WHERE w kroku 2.

---

## Tagowanie kampanii JSU

W temacie kampanii mailowej dodaj tag lub prefix:
```
[JSU] Webinar "Jak się uczyć" — czwartek 18:00
```

Albo mapuj po `list_segment` lub ID kampanii w ESP.  
Make powinien wstawiać `product_tag = 'JSU'` przy każdej kampanii promującej ten webinar.

---

## Testowanie

1. Uruchom `supabase/webinar_funnel_schema.sql` w Supabase SQL Editor.
2. Wstaw manualnie testową sesję:
```sql
INSERT INTO webinar_sessions (session_name, product_tag, scheduled_at, registered_count, attendee_count)
VALUES ('Jak się uczyć TEST', 'JSU', NOW() - INTERVAL '2 days', 50, 32);
```
3. Sprawdź widok:
```sql
SELECT * FROM v_webinar_jsu_funnel_by_session;
```
4. W aplikacji GIENIU: zakładka JSU Webinar Funnel → powinny pojawić się dane.
