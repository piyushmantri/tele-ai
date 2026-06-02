// Per-application Telegram bot runner using gramjs (same MTProto client as
// tele's own bot). Each code-type application that has a bot_config row with
// a bot_token in its external database gets its own TelegramClient. Multiple
// Telegram users are handled naturally — each has their own chatId from the
// incoming message, and counseller-type apps key their DB state on chatId.
//
// Lifecycle:
// - startApplicationBots() called once at server boot; polls bot_config every
//   20s so changes saved via tele's UI activate without restart.
// - Each app gets a session file at data/application-bots/<appId>.txt.
// - On token change: old client disconnected, new one started.
//
// Message routing per event:
// - Slash commands  → hook.handleSlashCommand(cmd, args, chatId, ctx)
// - Free text       → hook.getContext(chatId, ctx) + Gemini single-turn
//                     → strip CALL:/cmd {json} markers → execute each
//                     → send cleaned reply

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { neon } from "@neondatabase/serverless";
import { config } from "../config.js";
import { listApplications } from "../db/repos/applications.js";
import { ensureAppMigrated } from "./appDatabase.js";
import { logger } from "../util/logger.js";

type HookCtx = { databaseUrl: string; geminiApiKey: string | null };
type HookModule = {
  getContext?: (chatId: string, ctx: HookCtx) => Promise<string>;
  handleSlashCommand?: (
    cmd: string,
    args: string,
    chatId: string,
    ctx: HookCtx,
  ) => Promise<string>;
  // Optional: hook exports this so the runner can ensure DB schema before
  // querying bot_config (avoids relying on tele's generic ensureAppMigrated
  // which needs a valid src/db/migrations/ dir at installed_path).
  ensureDb?: (databaseUrl: string) => Promise<void>;
};

const SESSION_DIR = "data/application-bots";
const appClients = new Map<string, TelegramClient>(); // appId → client
const appTokens = new Map<string, string>(); // appId → "" when no token
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

let genAI: GoogleGenerativeAI | null = null;
function getGenAI(): GoogleGenerativeAI | null {
  if (!config.GEMINI_API_KEY) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  return genAI;
}

async function loadSession(appId: string): Promise<string> {
  try {
    return (await readFile(join(SESSION_DIR, `${appId}.txt`), "utf8")).trim();
  } catch {
    return "";
  }
}

async function saveSession(appId: string, s: string): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(join(SESSION_DIR, `${appId}.txt`), s, { mode: 0o600 });
}

const SLASH_RE = /^\/([a-z-]+)(?:\s+([\s\S]*))?$/;
const CALL_RE = /CALL:\s*(\/[a-z-]+)\s*(\{[^}]*\})/g;

function makeHandler(
  appId: string,
  installedPath: string,
  databaseUrl: string,
  targetChatId: string | null,
): (event: NewMessageEvent) => Promise<void> {
  return async (event: NewMessageEvent) => {
    const msg = event.message;
    const text = (msg.text ?? "").trim();
    if (!text) return;
    const chatId = String(msg.chatId ?? "");
    if (!chatId) return;
    if (targetChatId && chatId !== targetChatId) return;

    let mod: HookModule;
    try {
      mod = (await import(
        pathToFileURL(join(installedPath, "src", "hook.ts")).href
      )) as HookModule;
    } catch (err) {
      logger.warn("applicationBotRunner: hook import failed", {
        appId,
        err: String(err),
      });
      return;
    }
    const ctx: HookCtx = { databaseUrl, geminiApiKey: config.GEMINI_API_KEY ?? null };

    const slashMatch = SLASH_RE.exec(text);
    if (slashMatch && typeof mod.handleSlashCommand === "function") {
      const cmd = slashMatch[1] ?? "";
      const args = slashMatch[2] ?? "";
      try {
        const reply = await mod.handleSlashCommand(cmd, args, chatId, ctx);
        await msg.reply({ message: reply });
      } catch (err) {
        logger.warn("applicationBotRunner: slash error", {
          appId,
          cmd,
          err: String(err),
        });
        await msg.reply({ message: "Error processing command." });
      }
      return;
    }

    const ai = getGenAI();
    if (!ai) {
      await msg.reply({
        message: "AI not configured (GEMINI_API_KEY missing). Use slash commands.",
      });
      return;
    }
    try {
      const systemPrompt =
        typeof mod.getContext === "function"
          ? await mod.getContext(chatId, ctx)
          : "";
      const model = ai.getGenerativeModel({ model: config.GEMINI_MODEL });
      const result = await model.generateContent({
        systemInstruction:
          systemPrompt +
          "\n\nWhen you need to persist data, emit a line starting with 'CALL: /command {json}' before your reply. These lines will be executed and stripped.",
        contents: [{ role: "user", parts: [{ text }] }],
      });
      let reply = result.response.text();
      for (const match of [...reply.matchAll(CALL_RE)]) {
        const cmd = (match[1] ?? "").replace(/^\//, "");
        const args = match[2] ?? "";
        if (typeof mod.handleSlashCommand === "function") {
          try {
            await mod.handleSlashCommand(cmd, args, chatId, ctx);
          } catch (err) {
            logger.warn("applicationBotRunner: CALL exec error", {
              appId,
              cmd,
              err: String(err),
            });
          }
        }
      }
      reply = reply.replace(CALL_RE, "").replace(/\n{3,}/g, "\n\n").trim();
      await msg.reply({ message: reply || "No response generated." });
    } catch (err) {
      logger.warn("applicationBotRunner: LLM error", { appId, err: String(err) });
      await msg.reply({ message: "Error generating reply. Please try again." });
    }
  };
}

async function stopApp(appId: string): Promise<void> {
  const client = appClients.get(appId);
  if (!client) return;
  try {
    await client.disconnect();
  } catch {
    // ignore
  }
  appClients.delete(appId);
  logger.info("applicationBotRunner: stopped", { appId });
}

async function tryStartApp(app: {
  id: string;
  database_url: string | null;
  installed_path: string | null;
}): Promise<void> {
  if (!app.database_url || !app.installed_path) return;
  try {
    // Try loading the hook first so it can run its own ensureDb (more reliable
    // than ensureAppMigrated which silently skips when migrations dir missing).
    const hookPath = join(app.installed_path, "src", "hook.ts");
    let mod: HookModule | null = null;
    try {
      mod = (await import(pathToFileURL(hookPath).href)) as HookModule;
    } catch {
      // no hook module — fall back to generic migrator
    }

    if (mod && typeof mod.ensureDb === "function") {
      await mod.ensureDb(app.database_url);
    } else {
      await ensureAppMigrated(app.installed_path, app.database_url);
    }

    const sql = neon(app.database_url);
    const rows = await sql(
      `SELECT bot_token, target_chat_id FROM bot_config WHERE id = 'default'`,
      [],
    );
    const cfg = (rows[0] as Record<string, unknown> | undefined) ?? null;
    const token = (cfg?.bot_token as string | null) ?? null;
    const existing = appTokens.get(app.id) ?? null;
    if ((token ?? "") === (existing ?? "")) return; // no change

    await stopApp(app.id);
    appTokens.set(app.id, token ?? "");
    if (!token) {
      logger.info("applicationBotRunner: token cleared", { appId: app.id });
      return;
    }

    const sessionStr = await loadSession(app.id);
    const client = new TelegramClient(
      new StringSession(sessionStr),
      config.TG_API_ID,
      config.TG_API_HASH,
      { connectionRetries: 10, autoReconnect: true, retryDelay: 3000 },
    );
    await client.start({
      botAuthToken: () => token,
      onError: (err) =>
        logger.error("applicationBotRunner: login error", {
          appId: app.id,
          err: String(err),
        }),
    });
    const newSession = client.session.save() as unknown as string;
    if (newSession && newSession !== sessionStr) await saveSession(app.id, newSession);

    const targetChatId = (cfg?.target_chat_id as string | null) ?? null;
    client.addEventHandler(
      (event: NewMessageEvent) => {
        makeHandler(app.id, app.installed_path!, app.database_url!, targetChatId)(
          event,
        ).catch((err) =>
          logger.error("applicationBotRunner: handler crash", {
            appId: app.id,
            err: String(err),
          }),
        );
      },
      new NewMessage({}),
    );

    appClients.set(app.id, client);
    logger.info("applicationBotRunner: started", { appId: app.id });
  } catch (err) {
    const msg = String(err);
    // App DB has no bot_config table — not a bot-enabled app, skip silently.
    if (msg.includes("bot_config") && msg.includes("does not exist")) return;
    logger.warn("applicationBotRunner: tryStartApp failed", {
      appId: app.id,
      err: msg,
    });
  }
}

export async function startApplicationBots(): Promise<void> {
  const apps = await listApplications();
  for (const app of apps.filter(
    (a) => a.type === "code" && a.database_url && a.installed_path,
  )) {
    await tryStartApp(app);
  }
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(async () => {
    try {
      const all = await listApplications();
      for (const app of all.filter(
        (a) => a.type === "code" && a.database_url && a.installed_path,
      )) {
        await tryStartApp(app);
      }
    } catch (err) {
      logger.warn("applicationBotRunner: watchdog error", { err: String(err) });
    }
  }, 20_000);
}
