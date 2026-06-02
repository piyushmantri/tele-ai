-- 0021: Track which applications were installed from the in-repo registry.
-- registry_slug = the manifest's slug (= the on-disk folder name under
-- apps/server/applications/registry/<slug>/). NULL for operator-created apps.
-- Intentionally NOT UNIQUE — uninstall + reinstall would otherwise break;
-- uniqueness lives on applications.slug already.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS registry_slug TEXT;

CREATE INDEX IF NOT EXISTS applications_registry_slug_idx ON applications(registry_slug);
