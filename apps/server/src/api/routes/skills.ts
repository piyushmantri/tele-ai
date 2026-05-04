import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  updateSkill,
} from "../../db/repos/skills.js";

const nameRegex = /^[a-z0-9_-]+$/;

const createSchema = z.object({
  name: z.string().min(1).regex(nameRegex, "lowercase alphanumeric, dash, underscore only"),
  description: z.string().optional().default(""),
  content: z.string().optional().default(""),
  path: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).regex(nameRegex, "lowercase alphanumeric, dash, underscore only").optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  path: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown };
  return e.code === "23505";
}

export async function registerSkillsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/skills", async () => {
    return { skills: await listSkills() };
  });

  app.post("/api/skills", async (req, reply) => {
    const body = createSchema.parse(req.body);
    const hasPath = typeof body.path === "string" && body.path.trim() !== "";
    const hasContent = typeof body.content === "string" && body.content.trim() !== "";
    if (!hasPath && !hasContent) {
      reply.code(400);
      return { error: "either content or path is required" };
    }
    try {
      const skill = await createSkill({
        name: body.name,
        description: body.description,
        content: body.content,
        path: hasPath ? body.path : null,
      });
      return { skill };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `skill name "${body.name}" already exists` };
      }
      throw err;
    }
  });

  app.put("/api/skills/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = updateSchema.parse(req.body);
    try {
      const updated = await updateSkill(id, body);
      if (!updated) {
        reply.code(404);
        return { error: "not found" };
      }
      return { skill: updated };
    } catch (err) {
      if (isUniqueViolation(err)) {
        reply.code(409);
        return { error: `skill name already exists` };
      }
      throw err;
    }
  });

  app.patch("/api/skills/:id/enabled", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const updated = await updateSkill(id, { enabled });
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return { skill: updated };
  });

  app.delete("/api/skills/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getSkill(id);
    if (!existing) {
      reply.code(404);
      return { error: "not found" };
    }
    await deleteSkill(id);
    return { ok: true };
  });

  app.get("/api/skills/:id/file", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const skill = await getSkill(id);
    if (!skill) {
      reply.code(404);
      return { error: "not found" };
    }
    if (!skill.path) {
      reply.code(400);
      return { error: "skill has no path configured" };
    }
    try {
      const content = await readFile(skill.path, "utf8");
      return { content };
    } catch (err) {
      reply.code(400);
      return {
        error: `unable to read path: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
}
