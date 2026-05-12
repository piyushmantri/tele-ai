import { Api, type TelegramClient } from "telegram";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";

const PING_INTERVAL_MS = 60_000;
const WATCH_INTERVAL_MS = 120_000;
const MISS_THRESHOLD = 3;

interface Slot {
  pingTimer: NodeJS.Timeout;
  watchTimer: NodeJS.Timeout;
  missCount: number;
}

const slots = new Map<string, Slot>();

export function startKeepalive(
  name: string,
  getClient: () => TelegramClient | null,
  restart?: () => Promise<void>,
): void {
  if (slots.has(name)) stopKeepalive(name);

  const slot: Slot = {
    missCount: 0,
    pingTimer: setInterval(() => {
      const c = getClient();
      if (!c?.connected) return;
      // updates.GetState is a small parameter-less RPC accepted by both
      // user and bot accounts. Used as keepalive because Api.Ping requires
      // a bigInt pingId from the big-integer transitive dep (not directly typed).
      void c
        .invoke(new Api.updates.GetState())
        .then(() => incCounter(`telegram.keepalive.${name}.ok`))
        .catch((err) => {
          incCounter(`telegram.keepalive.${name}.err`);
          logger.warn("keepalive ping failed", { name, err: err instanceof Error ? err.message : String(err) });
        });
    }, PING_INTERVAL_MS),
    watchTimer: setInterval(() => {
      void (async () => {
        const c = getClient();
        if (c?.connected) {
          slot.missCount = 0;
          incCounter(`telegram.watchdog.${name}.healthy`);
          return;
        }
        slot.missCount += 1;
        logger.warn("watchdog miss", { name, missCount: slot.missCount });
        if (slot.missCount >= MISS_THRESHOLD && restart) {
          slot.missCount = 0;
          incCounter(`telegram.watchdog.${name}.restarted`);
          try {
            await restart();
          } catch (err) {
            incCounter(`telegram.watchdog.${name}.restart_failed`);
            logger.error("watchdog restart failed", { name, err: err instanceof Error ? err.message : String(err) });
          }
        }
      })();
    }, WATCH_INTERVAL_MS),
  };
  slots.set(name, slot);
  logger.info("keepalive started", { name });
}

export function stopKeepalive(name: string): void {
  const slot = slots.get(name);
  if (!slot) return;
  clearInterval(slot.pingTimer);
  clearInterval(slot.watchTimer);
  slots.delete(name);
  logger.info("keepalive stopped", { name });
}
