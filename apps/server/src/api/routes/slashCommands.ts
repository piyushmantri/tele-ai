import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSlashCommand,
  deleteSlashCommand,
  getSlashCommand,
  listSlashCommands,
  updateSlashCommand,
} from "../../db/repos/slashCommands.js";

const nameRegex = /^[a-z0-9_-]+$/;

const typeEnum = z.enum(["shell", "message", "ai_prompt", "noop"]);

const createSchema = z.object({
  name: z.string().min(1).regex(nameRegex, "lowercase alphanumeric, dash, underscore only"),
  description: z.string().optional().default(""),
  type: typeEnum,
  action: z.string().min(1, "action is required"),
});

const updateSchema = z.object({
  name: z.string().min(1).regex(nameRegex, "lowercase alphanumeric, dash, underscore only").optional(),
  description: z.string().optional(),
  type: typeEnum.optional(),
  action: z.string().optional(),
  enabled: z.boolean().optional(),
});

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown };
  return e.code === "23505";
}

export async function registerSlashCommandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/slash-commands", async () => {
    return { slash_commands: await listSlashCommands() };
  });

  app.post("/api/slash-commands", async (req, reply) => {
    const body = createSchema.parse(req.body);
    try {
      const slash_command = await createSlashCommand({
        name: body.name,
        description: body.description,
        type: body.type,
        action: body.action,
      });
      return { slash_command };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `slash command name "${body.name}" already exists` };
      }
      throw err;
    }
  });

  app.put("/api/slash-commands/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    const existing = await getSlashCommand(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    const merged = {
      name: Object.prototype.hasOwnProperty.call(body, "name") ? body.name! : existing.name,
      type: Object.prototype.hasOwnProperty.call(body, "type") ? body.type! : existing.type,
      action: Object.prototype.hasOwnProperty.call(body, "action") ? body.action! : existing.action,
    };
    if (!nameRegex.test(merged.name)) {
      reply.code(400);
      return { error: "name must be lowercase alphanumeric, dash, underscore only" };
    }
    if (!merged.action || merged.action.length === 0) {
      reply.code(400);
      return { error: "action cannot be empty" };
    }
    if (!["shell", "message", "ai_prompt", "noop"].includes(merged.type)) {
      reply.code(400);
      return { error: "invalid type" };
    }
    try {
      const updated = await updateSlashCommand(id, body);
      if (!updated) {
        reply.code(404);
        return { error: "not found" };
      }
      return { slash_command: updated };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `slash command name already exists` };
      }
      throw err;
    }
  });

  app.patch("/api/slash-commands/:id/enabled", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const updated = await updateSlashCommand(id, { enabled });
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return { slash_command: updated };
  });

  app.delete("/api/slash-commands/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getSlashCommand(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteSlashCommand(id);
    return { ok: true };
  });
}
