-- Singleton-per-model_id pricing for Gemini cost computation.
-- Auto-fetched columns (input_per_1m_usd, output_per_1m_usd, source_url, fetched_at)
-- are written by refreshPricing() in apps/server/src/ai/pricing.ts.
-- Override columns (override_input, override_output) are operator-managed via
-- PUT /api/metrics/pricing. When both override_* are non-null they take precedence.
-- auto_refresh_enabled defaults TRUE so the 24h scheduler picks the row up.
-- No CHECK on price columns: the zod schema in the fetcher rejects negatives,
-- and a CHECK would block manual SQL fixes for malformed rows.
CREATE TABLE IF NOT EXISTS model_pricing (
  model_id              TEXT PRIMARY KEY,
  input_per_1m_usd      NUMERIC,
  output_per_1m_usd     NUMERIC,
  source_url            TEXT,
  fetched_at            TIMESTAMPTZ,
  override_input        NUMERIC,
  override_output       NUMERIC,
  auto_refresh_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
