-- 0022: DB-backed application registry. Replaces the filesystem-as-source-of-truth
-- registry under apps/server/applications/registry/<slug>/ with a table that
-- catalogues plugin sources (git URL or local absolute path). On install the
-- source is materialized at <installed_path> (data/applications/<slug>/ for git,
-- source_path verbatim for local) and that absolute path is stored on the
-- applications row (migration 0023).
--
-- XOR CHECK enforces that source_url is set for git and source_path is set for
-- local; the application layer (POST /api/applications/registry) does the
-- richer absolute-path / no-`~` checks before insert.
--
-- Dev-local seed: kundali-match points at /Users/piyush.mantri/spaps/kundali.
-- ON CONFLICT DO NOTHING (per lessons-2026-04-30: seed rows with machine-specific
-- paths are fine if idempotent and user-editable). On any other host the seed
-- still inserts but `resolveInstalledPath` will fail at fs.access time on the
-- first install attempt — operator's recovery is to DELETE the row from the
-- dashboard Browse tab and re-POST with their own path/URL.
--
-- Runner contract (per lessons-2026-04-28): statements split on `;`, run
-- individually via Neon serverless. All DDL idempotent.

CREATE TABLE IF NOT EXISTS application_registry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('git', 'local')),
  source_url  TEXT,
  source_path TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (source_type = 'git'   AND source_url  IS NOT NULL) OR
    (source_type = 'local' AND source_path IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS application_registry_slug_idx ON application_registry(slug);

INSERT INTO application_registry (slug, source_type, source_path)
VALUES ('kundali-match', 'local', '/Users/piyush.mantri/spaps/kundali')
ON CONFLICT (slug) DO NOTHING;
