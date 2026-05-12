-- Default-block all newly inserted chats. Existing rows are untouched.
-- upsertChat in apps/server/src/db/repos/chats.ts deliberately omits
-- is_blocked from its INSERT column list so this default applies on first
-- INSERT and the existing value is preserved on ON CONFLICT DO UPDATE.
ALTER TABLE chats ALTER COLUMN is_blocked SET DEFAULT TRUE;
