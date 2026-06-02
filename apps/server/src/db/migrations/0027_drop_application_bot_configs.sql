-- application_bot_configs was created in migration 0026 but belongs in each
-- application's own external database (defined in the app's src/db/migrations/).
-- Counseller's bot_config lives in 0003_bot_config.sql in the counseller repo.
DROP TABLE IF EXISTS application_bot_configs;
