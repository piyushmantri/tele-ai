import { config, maskedDatabaseUrl } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./util/logger.js";
import { startTelegram } from "./telegram/client.js";
import { initRouter } from "./telegram/router.js";
import { startScheduler } from "./scheduler/index.js";
import { startApi } from "./api/index.js";
import { initMCP } from "./mcp/manager.js";

async function main(): Promise<void> {
  logger.info("starting telegram-ai-agent", {
    db: maskedDatabaseUrl(),
    port: config.PORT,
  });

  await runMigrations();
  await initMCP();

  const tg = await startTelegram();
  initRouter(tg);
  await startScheduler(tg);
  await startApi(tg);

  logger.info("ready");
}

main().catch((err) => {
  logger.error("fatal", { err: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
