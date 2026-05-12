-- Per-chat AI context (appended to system instruction) and slash-only mode
-- (drop non-slash inbound messages silently).
--
-- Coupled with apps/server/src/db/repos/chats.ts: upsertChat() deliberately
-- omits ai_context and slash_only from BOTH its INSERT column list AND its
-- ON CONFLICT DO UPDATE SET list. New rows get the DB defaults; existing
-- rows keep their values. Do NOT add either column to upsertChat without
-- understanding this default-preservation contract (see lessons-2026-05-08).
ALTER TABLE chats ADD COLUMN IF NOT EXISTS ai_context TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS slash_only BOOLEAN NOT NULL DEFAULT FALSE;
