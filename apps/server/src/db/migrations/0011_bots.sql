CREATE TABLE IF NOT EXISTS bots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  description   TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_chats (
  bot_id  UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  PRIMARY KEY (bot_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_chats_chat ON bot_chats(chat_id);
