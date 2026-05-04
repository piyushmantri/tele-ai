CREATE TABLE IF NOT EXISTS slash_commands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL CHECK (type IN ('shell','message','ai_prompt')),
  action      TEXT NOT NULL DEFAULT '',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO slash_commands (name, description, type, action) VALUES ('ping', 'Replies pong.', 'message', 'pong') ON CONFLICT (name) DO NOTHING;

INSERT INTO slash_commands (name, description, type, action) VALUES ('help', 'Lists configured slash commands.', 'message', 'Available commands: /ping, /help. Manage them from the dashboard.') ON CONFLICT (name) DO NOTHING;
