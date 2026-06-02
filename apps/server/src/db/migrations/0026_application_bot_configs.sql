CREATE TABLE IF NOT EXISTS application_bot_configs (
  application_id UUID PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  bot_token TEXT,
  target_chat_id TEXT,
  last_connected_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
