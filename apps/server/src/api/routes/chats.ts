import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listChats, getChatById, clearUnread, getChatByTgId, setChatBlocked, deleteChat, setChatAiContext, setChatSlashOnly } from "../../db/repos/chats.js";
import { listMessages } from "../../db/repos/messages.js";
import { sendReply } from "../../telegram/sender.js";
import { eventBus } from "../../util/eventBus.js";

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

  app.patch("/api/chats/:id/context", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ context: z.string().max(8000).nullable() }).parse(req.body);
    const chat = await getChatById(params.id);
    if (!chat) { reply.code(404); return { error: "chat not found" }; }
    const trimmed = body.context == null ? null : (body.context.trim() === "" ? null : body.context);
    await setChatAiContext(params.id, trimmed);
    const updated = await getChatById(params.id);
    if (updated) eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
    return { ok: true };
  });

  app.patch("/api/chats/:id/slash-only", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ slash_only: z.boolean() }).parse(req.body);
    const chat = await getChatById(params.id);
    if (!chat) { reply.code(404); return { error: "chat not found" }; }
    await setChatSlashOnly(params.id, body.slash_only);
    const updated = await getChatById(params.id);
    if (updated) eventBus.emit({ type: "chat:updated", payload: { chat: updated } });
    return { ok: true };
  });

  app.delete("/api/chats/:id", async (req, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const chat = await getChatById(params.id);
    if (!chat) { reply.code(404); return { error: "chat not found" }; }
    await deleteChat(params.id);
    eventBus.emit({ type: "chat:deleted", payload: { chat_id: params.id } });
    return { ok: true };
  });
}
