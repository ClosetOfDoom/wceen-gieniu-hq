# ClickMeeting Participant Mapping Fix

## Problem

Make HTTP module was sending the full ClickMeeting registration object into the
`email` column of `webinar_participants` instead of just the email string.

**Example malformed row** (what appeared in the Email column):
```
{"email":"abc@gmail.com","registration_date":"2026-06-14T18:01:00Z"}
```

This caused:
- Raw JSON shown in the Webinars page participant table instead of masked email
- `registered_count` staying at 0 because the view could not join on a clean email
- GIENIU reporting "Reg: — / Live: — / Show-up: —" even though participant rows existed

## Root Cause

The Make HTTP module that receives the ClickMeeting webhook/API response was mapping the
entire registration body object to the `email` field, rather than extracting the `email`
property.

## Short-Term Fix (Already Live)

`src/lib/clickmeetingNormalize.ts` — defensive parser that:
1. Detects when `email` field contains a JSON-like string
2. Extracts the first valid email address via regex
3. Extracts `registration_date` from the embedded JSON when `registered_at` is null
4. Always masks emails for display (`ab***@domain.com`)

`src/services/webinarFunnel.ts` — aggregation fallback:
- When `webinar_sessions.registered_count = 0` but participant rows exist, uses
  `COUNT(webinar_participants)` as the registration count
- Falls through the view path to raw-tables path when view shows 0 registrations

## Permanent Fix (Required in Make)

Update the Make scenario that inserts rows into `webinar_participants`.

### Correct field mapping

| Supabase column        | Make field                           |
|------------------------|--------------------------------------|
| `email`                | `registration.email` (string only)   |
| `registered_at`        | `registration.registration_date`     |
| `session_id`           | webinar session ID from ClickMeeting |
| `attended`             | boolean — set after webinar ends     |
| `attend_duration_min`  | duration in minutes, if available    |
| `purchased_at`         | from Wix order match (separate step) |
| `purchase_value`       | from Wix order match (separate step) |

### Make HTTP body example (correct)

```json
{
  "session_id": "{{webinar_id}}",
  "email": "{{registrant.email}}",
  "registered_at": "{{registrant.registration_date}}",
  "attended": false,
  "attend_duration_min": null
}
```

### Common mistake

Using the full registration object as the email value:
```
email: {{registrant}}   ← WRONG — sends full object
email: {{registrant.email}}   ← CORRECT — sends string only
```

## Verifying the Fix

After updating Make:
1. Trigger a test registration in ClickMeeting
2. Check Supabase `webinar_participants` — `email` column should be a plain string
3. Reload the Webinars page — Email column should show `ab***@gmail.com` not JSON
4. `registered_count` should auto-populate from participant rows

## Related Files

- `src/lib/clickmeetingNormalize.ts` — defensive email parser
- `src/services/webinarFunnel.ts` — funnel loader with participant count fallback
- `src/components/ParticipantJourneyTable.tsx` — display with email masking
- `docs/clickmeeting_make_scenarios.md` — full Make integration guide
