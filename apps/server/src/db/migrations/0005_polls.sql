CREATE TABLE IF NOT EXISTS sent_polls (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  poll_id    TEXT NOT NULL UNIQUE,
  question   TEXT NOT NULL,
  options    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sent_polls_chat_id ON sent_polls (chat_id);
