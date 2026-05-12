import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { startKeepalive } from "./keepalive.js";

let _client: TelegramClient | null = null;

async function loadSession(): Promise<string> {
  const envSession = process.env.SESSION_STRING?.trim();
  if (envSession) return envSession;
  try {
    return (await readFile(config.SESSION_FILE, "utf8")).trim();
  } catch {
    return "";
  }
}

async function saveSession(s: string): Promise<void> {
  await mkdir(dirname(config.SESSION_FILE), { recursive: true });
  await writeFile(config.SESSION_FILE, s, { mode: 0o600 });
}

function prompt(label: string): () => Promise<string> {
  return async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`${label}: `);
      return answer.trim();
    } finally {
      rl.close();
    }
  };
}

export async function startTelegram(restartCb?: () => Promise<void>): Promise<TelegramClient> {
  // Idempotent: if a previous client is still around (watchdog restart path),
  // tear it down before constructing a fresh one.
  if (_client) {
    try {
      await _client.disconnect();
    } catch {
      // ignore — previous client may already be dead
    }
    _client = null;
  }
  const sessionStr = await loadSession();
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, config.TG_API_ID, config.TG_API_HASH, {
    connectionRetries: 20,
    autoReconnect: true,
    retryDelay: 2000,
  });

  await client.start({
    phoneNumber: prompt("Phone number (international, e.g. +123456789)"),
    password: prompt("2FA password (leave blank if none)"),
    phoneCode: prompt("Login code from Telegram"),
    onError: (err) => logger.error("telegram login error", { err: String(err) }),
  });

  const newSession = client.session.save() as unknown as string;
  if (newSession && newSession !== sessionStr) {
    await saveSession(newSession);
    logger.info("session saved", { file: config.SESSION_FILE });
  }

  logger.info("Telegram client ready");
  _client = client;
  startKeepalive("user", () => _client, restartCb);
  return client;
}

export function getClient(): TelegramClient {
  if (!_client) throw new Error("Telegram client not initialized");
  return _client;
}

export function isConnected(): boolean {
  return Boolean(_client?.connected);
}
