-- Internal table tracking AI-issued choice prompts awaiting user selection.
-- One row per ask_user_choice() invocation. Token is the lookup key embedded
-- in callback_data (format: c colon token colon idx). Rows are kept after
-- consumption for audit; expiry is 24h from creation.
CREATE TABLE IF NOT EXISTS pending_choices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token            TEXT NOT NULL UNIQUE,
  source_chat_id   UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  question         TEXT NOT NULL,
  options          JSONB NOT NULL,
  delivered_via    TEXT NOT NULL,
  delivery_chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  expires_at       TIMESTAMPTZ NOT NULL,
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pending_choices_token_idx ON pending_choices(token);
