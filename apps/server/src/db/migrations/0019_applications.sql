-- Applications framework: typed app records (code | ai_only) with optional
-- per-app DATABASE_URL, system prompt, knowledge base, and per-chat / global
-- assignment. Active apps' system_prompt + knowledge_base (and code-app
-- getContext output) are injected into the AI system instruction at responder
-- time (see apps/server/src/ai/applications.ts).
--
-- Runner contract (see lessons-2026-04-28): each statement is split on `;`
-- and run individually via the Neon serverless driver. All DDL is idempotent.

CREATE TABLE IF NOT EXISTS applications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL CHECK (type IN ('code', 'ai_only')),
  description       TEXT NOT NULL DEFAULT '',
  system_prompt     TEXT,
  knowledge_base    TEXT,
  database_url      TEXT,
  is_global_default BOOLEAN NOT NULL DEFAULT FALSE,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_chats (
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  chat_id        UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (application_id, chat_id)
);

CREATE INDEX IF NOT EXISTS application_chats_chat_id_idx ON application_chats(chat_id);
