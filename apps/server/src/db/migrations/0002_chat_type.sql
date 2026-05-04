ALTER TABLE chats ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'private' CHECK (chat_type IN ('private','group','channel'));
