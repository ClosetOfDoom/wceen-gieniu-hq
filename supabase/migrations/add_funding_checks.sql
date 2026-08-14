-- ============================================================
-- funding_checks — per-opportunity "check the programme page by" date.
--
-- funding.ts is a build-time constant and the browser cannot write to it, so the
-- editable checkBy value lives here. One row per funding id; absence of a row
-- means "no check date set", which the UI grades as SPRAWDŹ TERAZ.
--
-- Run ONCE in the Supabase SQL editor. Additive — touches nothing existing.
-- ============================================================

CREATE TABLE IF NOT EXISTS funding_checks (
  funding_id  text PRIMARY KEY,          -- matches FundingItem.id in src/data/funding.ts
  check_by    date,                      -- NULL = not scheduled yet
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at honest on every upsert.
CREATE OR REPLACE FUNCTION funding_checks_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_funding_checks_touch ON funding_checks;
CREATE TRIGGER trg_funding_checks_touch
  BEFORE UPDATE ON funding_checks
  FOR EACH ROW EXECUTE FUNCTION funding_checks_touch();

-- ──────────────────────────────────────────────────────────
-- Access. The dashboard is a private single-tenant tool whose frontend holds
-- only the anon key, and this table is the one place that key must be able to
-- WRITE. RLS stays on with an explicit permissive policy rather than off, so the
-- grant is visible and can be tightened later without a schema change.
-- ──────────────────────────────────────────────────────────
ALTER TABLE funding_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funding_checks_anon_rw ON funding_checks;
CREATE POLICY funding_checks_anon_rw ON funding_checks
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON funding_checks TO anon, authenticated;
