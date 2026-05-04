import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listChats, getChatById, clearUnread, getChatByTgId, setChatBlocked } from "../../db/repos/chats.js";
import { listMessages } from "../../db/repos/messages.js";
import { sendReply } from "../../telegram/sender.js";

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/chats", async () => {
    const chats = await listChats();
    return { chats };
  });

  app.get("/api/chats/:id/messages", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.string().optional() })
      .parse(req.query);
    const messages = await listMessages(params.id, query.limit, query.before);
    return { messages };
  });

  app.post("/api/chats/:id/read", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await clearUnread(params.id);
    return { ok: true };
  });

  app.post("/api/chats/:id/send", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ text: z.string().min(1) }).parse(req.body);
    const chat = await getChatById(params.id);
    if (!chat) {
      reply.code(404);
      return { error: "chat not found" };
    }
    await sendReply(chat, body.text, "manual");
    return { ok: true };
  });

  app.get("/api/chats/by-tg/:tgId", async (req, reply) => {
    const params = z.object({ tgId: z.string() }).parse(req.params);
    const chat = await getChatByTgId(params.tgId);
    if (!chat) {
      reply.code(404);
      return { error: "not found" };
    }
    return { chat };
  });

  app.patch("/api/chats/:id/blocked", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ blocked: z.boolean() }).parse(req.body);
    const chat = await getChatById(params.id);
    if (!chat) { reply.code(404); return { error: "chat not found" }; }
    await setChatBlocked(params.id, body.blocked);
    return { ok: true };
  });
}
