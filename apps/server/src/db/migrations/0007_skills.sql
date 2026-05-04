CREATE TABLE IF NOT EXISTS skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  path        TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO skills (name, description, path)
VALUES (
  'grail-explorer',
  'Query Uber''s Grail runtime data store using natural language. Use for grail/Odin/O2/compute/UIM questions.',
  '/Users/piyush.mantri/Downloads/grail-explorer/SKILL.md'
) ON CONFLICT (name) DO NOTHING;
