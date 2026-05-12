-- Adds singleton telegram_bot_config and extends chats UNIQUE+CHECK for chat_type='bot'.
-- Old bots/bot_chats tables (migration 0011) intentionally left in place for rollback safety.
-- No new env vars. bot client uses GramJS botAuthToken with the existing TG_API_ID/TG_API_HASH.

CREATE TABLE IF NOT EXISTS telegram_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_bot_config_singleton ON telegram_bot_config((TRUE));

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_tg_chat_id_key;

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_tg_chat_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS chats_tg_chat_id_chat_type_key ON chats(tg_chat_id, chat_type);

ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_chat_type_check;

ALTER TABLE chats ADD CONSTRAINT chats_chat_type_check CHECK (chat_type IN ('private','group','channel','bot'));
