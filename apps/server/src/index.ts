import { config, maskedDatabaseUrl } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./util/logger.js";
import { startTelegram } from "./telegram/client.js";
import { initRouter } from "./telegram/router.js";
import { startScheduler } from "./scheduler/index.js";
import { startApi } from "./api/index.js";
import { initMCP } from "./mcp/manager.js";
import { getTelegramBotConfig } from "./db/repos/telegramBotConfig.js";
import { startBotClient } from "./telegram/botClient.js";
import { stopKeepalive } from "./telegram/keepalive.js";
import { loadLatestFromInflux, persistToInflux } from "./util/metrics.js";
import { flush as influxFlush } from "./util/influx.js";
import { persistAppTimeseries, loadAppTimeseriesFromInflux } from "./ai/applicationMetrics.js";
import {
  loadPricingFromDb,
  refreshPricing,
  getPricingMeta,
} from "./ai/pricing.js";
import { startApplicationBots } from "./ai/applicationBotRunner.js";

async function main(): Promise<void> {
  logger.info("starting telegram-ai-agent", {
    db: maskedDatabaseUrl(),
    port: config.PORT,
  });

  await runMigrations();
  await initMCP();

  // Restore counters/gauges/errors from latest InfluxDB snapshot. Non-fatal:
  // a missing token, network blip, or bad query must NOT block boot.
  try {
    await loadLatestFromInflux();
  } catch (err) {
    logger.error("influx restore failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Restore app timeseries from Influx (last 3h window). Non-fatal.
  try {
    await loadAppTimeseriesFromInflux();
  } catch (err) {
    logger.error("app timeseries restore failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Load model pricing cache from DB (non-fatal — cost counter just stays 0
  // until the next refresh succeeds; lessons-2026-05-07).
  try {
    await loadPricingFromDb();
  } catch (err) {
    logger.error("pricing load failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const restartUser = async (): Promise<void> => {
    logger.warn("restarting user-account telegram client (watchdog)");
    const c = await startTelegram(restartUser);
    initRouter(c);
  };
  const tg = await startTelegram(restartUser);
  initRouter(tg);
  await startScheduler(tg);
  await startApi(tg);

  const botCfg = await getTelegramBotConfig();
  if (botCfg?.enabled && botCfg.token) {
    await startBotClient(botCfg.token).catch((err) =>
      logger.error("bot client failed to start at boot", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  startApplicationBots().catch((err) =>
    logger.error("startApplicationBots failed", {
      err: err instanceof Error ? err.message : String(err),
    }),
  );

  logger.info("ready");

  // 60s snapshot interval. No-op when influx unconfigured. Per-tick failures
  // log via the .catch and do not stop the interval.
  setInterval(() => {
    void persistToInflux().catch((err) =>
      logger.error("metrics persist failed", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
    void persistAppTimeseries().catch((err) =>
      logger.error("app timeseries persist failed", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }, 60_000);

  // 24h pricing refresh tick. refreshPricing() never throws.
  setInterval(() => {
    void refreshPricing();
  }, 24 * 60 * 60 * 1000);

  // Post-boot one-shot: only fetch if no cache OR fetched_at is older than 7d.
  // Operator-friendly: fresh installs get pricing within 2 min; long-running
  // prod processes don't re-fetch on every restart.
  setTimeout(() => {
    const meta = getPricingMeta();
    const stale =
      !meta.fetched_at ||
      new Date(meta.fetched_at).getTime() < Date.now() - 7 * 24 * 3600_000;
    if (stale) void refreshPricing();
  }, 2 * 60 * 1000);

  process.on("SIGTERM", () => {
    stopKeepalive("user");
    stopKeepalive("bot");
    void influxFlush()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

main().catch((err) => {
  logger.error("fatal", { err: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
