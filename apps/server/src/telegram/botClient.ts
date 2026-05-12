import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { CallbackQuery, type CallbackQueryEvent } from "telegram/events/CallbackQuery.js";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { handleBotMessage, handleBotCallback } from "../ai/botEventHandler.js";
import { startKeepalive, stopKeepalive } from "./keepalive.js";
import { getTelegramBotConfig } from "../db/repos/telegramBotConfig.js";

const BOT_SESSION_FILE = process.env.BOT_SESSION_FILE ?? "data/bot-session.txt";

let _botClient: TelegramClient | null = null;

async function loadBotSession(): Promise<string> {
  const envSession = process.env.BOT_SESSION_STRING?.trim();
  if (envSession) return envSession;
  try {
    return (await readFile(BOT_SESSION_FILE, "utf8")).trim();
  } catch {
    return "";
  }
}

async function saveBotSession(s: string): Promise<void> {
  await mkdir(dirname(BOT_SESSION_FILE), { recursive: true });
  await writeFile(BOT_SESSION_FILE, s, { mode: 0o600 });
}

export async function startBotClient(token: string): Promise<TelegramClient> {
  if (_botClient) {
    await stopBotClient();
  }
  const sessionStr = await loadBotSession();
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, config.TG_API_ID, config.TG_API_HASH, {
    connectionRetries: 20,
    autoReconnect: true,
    retryDelay: 2000,
  });

  await client.start({
    botAuthToken: () => token,
    onError: (err) => logger.error("bot login error", { err: String(err) }),
  });

  const newSession = client.session.save() as unknown as string;
  if (newSession && newSession !== sessionStr) {
    await saveBotSession(newSession);
    logger.info("bot session saved", { file: BOT_SESSION_FILE });
  }

  client.addEventHandler((event: NewMessageEvent) => {
    handleBotMessage(event).catch((err) =>
      logger.error("bot message handler crash", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }, new NewMessage({}));

  client.addEventHandler((event: CallbackQueryEvent) => {
    logger.info("bot CallbackQuery event received", {
      hasData: Boolean(event.data),
    });
    handleBotCallback(event).catch((err) =>
      logger.error("bot callback handler crash", {
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }, new CallbackQuery({}));

  _botClient = client;
  logger.info("bot client started");
  startKeepalive("bot", () => _botClient, async () => {
    const cfg = await getTelegramBotConfig();
    if (!cfg?.enabled || !cfg.token) return;
    await startBotClient(cfg.token);
  });
  return client;
}

export async function stopBotClient(): Promise<void> {
  if (!_botClient) return;
  stopKeepalive("bot");
  try {
    await _botClient.disconnect();
  } catch (err) {
    logger.warn("bot client disconnect error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  _botClient = null;
  logger.info("bot client stopped");
}

export function getBotClient(): TelegramClient | null {
  return _botClient;
}

export function isBotConnected(): boolean {
  return Boolean(_botClient?.connected);
}
