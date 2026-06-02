-- kundali_matches was mistakenly created in tele's main DB by migration 0024.
-- Matches belong in the application's own database_url (external DB), not here.
-- The table is bootstrapped lazily in the external DB by appDatabase.ts on first use.

DROP TABLE IF EXISTS kundali_matches
