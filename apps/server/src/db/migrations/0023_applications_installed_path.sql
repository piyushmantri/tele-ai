-- 0023: Add applications.installed_path. Replaces the implicit
-- APPLICATIONS_DIR/<slug> convention with an explicit absolute path stored on
-- each application row at install time. Dev-local backfill seeds kundali to
-- the operator's local checkout; the second UPDATE breaks dangling
-- registry_slug refs on rows whose registry folders were deleted in this
-- atomic-block refactor.
--
-- HONEST FAILURE MODE (per critic V3): on non-Piyush hosts the first UPDATE
-- silently no-ops because there's no FS check in SQL. The kundali install row
-- keeps installed_path=NULL, the hook never loads, ai/applications.ts
-- warn-logs "code app missing installed_path", and the operator's recovery
-- is to re-install kundali from the dashboard's Browse tab. Silent succeed
-- beats a fake guarantee.
--
-- Runner contract: idempotent ALTER ... IF NOT EXISTS so re-runs are no-ops.

ALTER TABLE applications ADD COLUMN IF NOT EXISTS installed_path TEXT;

-- Dev-local backfill (per critic V3); silently no-ops on other hosts.
UPDATE applications
   SET installed_path = '/Users/piyush.mantri/spaps/kundali'
 WHERE registry_slug = 'kundali-match'
   AND installed_path IS NULL;

-- Break dangling refs to deleted registry entries (per critic V6/V7) so the
-- dashboard's "is this slug installed?" logic stops referencing removed
-- registry sources. ai_only apps continue to function (registry_slug was
-- decorative for them); uptime-monitor row becomes a non-loading orphan the
-- operator can delete from the Installed tab.
UPDATE applications
   SET registry_slug = NULL
 WHERE registry_slug IN ('code-review', 'translator', 'uptime-monitor');
