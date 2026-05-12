-- Cleanup: remove the seeded /delete row from slash_commands. The built-in
-- /delete command is now surfaced via a separate hardcoded "System commands"
-- section in the dashboard, not by polluting the user-defined slash_commands
-- table. Idempotent.
DELETE FROM slash_commands WHERE name = 'delete' AND type = 'noop' AND action = '';
