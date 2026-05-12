import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearTelegramBotConfig,
  getTelegramBotConfig,
  setEnabled,
  setTelegramBotConfig,
} from "../../db/repos/telegramBotConfig.js";
import { startBotClient, stopBotClient } from "../../telegram/botClient.js";
import { logger } from "../../util/logger.js";

const updateSchema = z
  .object({
    token: z.string().min(20).optional(),
    system_prompt: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "empty patch" });

const enabledSchema = z.object({ enabled: z.boolean() });

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown };
  return e.code === "23505";
}

async function reconcileClient(enabled: boolean, token: string | null): Promise<void> {
  if (enabled && token) {
    await stopBotClient();
    await startBotClient(token).catch((err) =>
      logger.error("bot client start failed", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  } else {
    await stopBotClient();
  }
}

export async function registerTelegramBotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/telegram-bot", async () => {
    const config = await getTelegramBotConfig();
    return { config };
  });

  app.put("/api/telegram-bot", async (req, reply) => {
    const body = updateSchema.parse(req.body);
    let saved;
    try {
      saved = await setTelegramBotConfig(body);
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: "token already in use" };
      }
      throw err;
    }
    await reconcileClient(saved.enabled, saved.token);
    return { config: saved };
  });

  app.patch("/api/telegram-bot/enabled", async (req, reply) => {
    const { enabled } = enabledSchema.parse(req.body);
    const existing = await getTelegramBotConfig();
    if (!existing) {
      reply.code(404);
      return { error: "no telegram bot config" };
    }
    const saved = await setEnabled(enabled);
    await reconcileClient(saved.enabled, saved.token);
    return { config: saved };
  });

  app.delete("/api/telegram-bot", async () => {
    await stopBotClient();
    await clearTelegramBotConfig();
    return { ok: true };
  });
}
