CREATE TABLE IF NOT EXISTS application_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  tg_chat_id     TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content        TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_messages_app_chat_idx
  ON application_messages(application_id, tg_chat_id, created_at);
