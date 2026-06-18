-- ClickMeeting participant data cleanup (OPTIONAL — do not run automatically)
-- Purpose: backfill registered_at from JSON-encoded email field, and extract clean email
-- Run only after verifying the SELECT queries return the expected rows.

-- ── Step 1: Preview rows with malformed email (JSON object in email column)
SELECT
  id,
  session_id,
  email,
  registered_at,
  created_at
FROM webinar_participants
WHERE email LIKE '{%'
   OR email LIKE '[%'
ORDER BY created_at DESC
LIMIT 50;

-- ── Step 2: Preview extracted email and registration_date from JSON
-- Uses Postgres JSON path extraction — check results before updating
SELECT
  id,
  email AS raw_email,
  CASE
    WHEN email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' THEN email
    ELSE (regexp_match(email, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', 'i'))[1]
  END AS extracted_email,
  CASE
    WHEN email LIKE '%registration_date%' THEN
      (regexp_match(email, '"registration_date"\s*:\s*"([^"]+)"'))[1]
    ELSE NULL
  END AS extracted_registration_date,
  registered_at
FROM webinar_participants
WHERE email LIKE '{%' OR email LIKE '[%'
ORDER BY created_at DESC
LIMIT 50;

-- ── Step 3 (OPTIONAL UPDATE): backfill registered_at from JSON email field
-- Only runs on rows where:
--   a) email contains registration_date JSON
--   b) registered_at is currently NULL
-- Dry-run as SELECT first.
/*
UPDATE webinar_participants
SET registered_at = (
  regexp_match(email, '"registration_date"\s*:\s*"([^"]+)"')
)[1]::timestamptz
WHERE email LIKE '%registration_date%'
  AND registered_at IS NULL
  AND (regexp_match(email, '"registration_date"\s*:\s*"([^"]+)"'))[1] IS NOT NULL;
*/

-- ── Step 4 (OPTIONAL UPDATE): extract clean email and store in email column
-- Only runs on rows where email is a JSON-like string containing a valid email
-- WARNING: this modifies the raw_email field — make a backup first
/*
UPDATE webinar_participants
SET email = (regexp_match(email, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', 'i'))[1]
WHERE (email LIKE '{%' OR email LIKE '[%')
  AND (regexp_match(email, '[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}', 'i'))[1] IS NOT NULL;
*/

-- ── Step 5: verify count after cleanup
SELECT
  COUNT(*) AS total_rows,
  COUNT(CASE WHEN email LIKE '%@%' THEN 1 END) AS valid_email_rows,
  COUNT(CASE WHEN email LIKE '{%' THEN 1 END) AS still_json_rows,
  COUNT(CASE WHEN registered_at IS NOT NULL THEN 1 END) AS rows_with_registration_date
FROM webinar_participants;
