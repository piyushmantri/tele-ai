ALTER TABLE slash_commands DROP CONSTRAINT IF EXISTS slash_commands_type_check;
ALTER TABLE slash_commands ADD CONSTRAINT slash_commands_type_check CHECK (type IN ('shell','message','ai_prompt','noop'));
