-- Seed the built-in /delete slash command so it appears in the dashboard.
-- The actual delete logic is hardcoded in slashDispatch.ts and runs BEFORE
-- this row is consulted. Type=noop is a placeholder. Editing the row in the
-- dashboard has no effect on the built-in behavior.
INSERT INTO slash_commands (name, description, type, action, enabled)
VALUES ('delete', 'Built-in. Deletes the current chat from the application.', 'noop', '', TRUE)
ON CONFLICT (name) DO NOTHING;
