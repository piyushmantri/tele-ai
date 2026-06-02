-- application_files: stores knowledge-base files for ai_only applications.
-- chat_id IS NULL  → app-level file (dashboard upload, applies to all chats with the app).
-- chat_id non-null → chat-scoped file (Telegram upload, applies only to that chat).
-- Files are stored on local disk (local_path) and lazily uploaded to the Gemini File API;
-- gemini_file_uri / gemini_file_name / gemini_expires_at cache the uploaded reference.

CREATE TABLE IF NOT EXISTS application_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  chat_id           UUID REFERENCES chats(id) ON DELETE CASCADE,
  filename          TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  size_bytes        INT NOT NULL,
  local_path        TEXT NOT NULL,
  gemini_file_uri   TEXT,
  gemini_file_name  TEXT,
  gemini_expires_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_files_app_id_idx ON application_files(application_id);

CREATE INDEX IF NOT EXISTS application_files_chat_id_idx ON application_files(chat_id);
