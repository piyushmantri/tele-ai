import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import type { TelegramClient } from "telegram";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { isConnected } from "../telegram/client.js";
import { registerChatRoutes } from "./routes/chats.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerRuleRoutes } from "./routes/rules.js";
import { registerReminderRoutes } from "./routes/reminders.js";
import { registerAuthRoutes, AUTH_COOKIE, getAuthToken } from "./routes/auth.js";
import { registerMCPRoutes } from "./routes/mcp.js";
import { registerKanbanRoutes } from "./routes/kanban.js";
import { registerSkillsRoutes } from "./routes/skills.js";
import { registerSlashCommandRoutes } from "./routes/slashCommands.js";
import { registerWs } from "./ws.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PUBLIC_PATHS = new Set<string>(["/api/login", "/api/me", "/api/health"]);

const startTime = Date.now();

export async function startApi(_client: TelegramClient): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cookie);
  await app.register(websocket);

  app.addHook("onRequest", async (req, reply) => {
    const url = req.url.split("?")[0] ?? "";
    if (!url.startsWith("/api")) return;
    if (PUBLIC_PATHS.has(url)) return;
    const cookies = (req as typeof req & { cookies?: Record<string, string> }).cookies ?? {};
    if (cookies[AUTH_COOKIE] !== getAuthToken()) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/api/health", async () => ({
    telegram_connected: isConnected(),
    uptime_s: Math.round((Date.now() - startTime) / 1000),
  }));

  await registerAuthRoutes(app);
  await registerChatRoutes(app);
  await registerSettingsRoutes(app);
  await registerRuleRoutes(app);
  await registerReminderRoutes(app);
  await registerMCPRoutes(app);
  await registerKanbanRoutes(app);
  await registerSkillsRoutes(app);
  await registerSlashCommandRoutes(app);

  registerWs(app, AUTH_COOKIE, getAuthToken());

  const webDist = join(__dirname, "../../../web/dist");
  if (existsSync(webDist)) {
    await app.register(staticPlugin, {
      root: webDist,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info("api listening", { port: config.PORT });
  return app;
}
