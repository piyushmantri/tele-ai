import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  listMCPServers,
  createMCPServer,
  updateMCPServer,
  deleteMCPServer,
  getMCPServer,
} from "../../db/repos/mcp.js";
import { reloadMCP, removeMCPClient } from "../../mcp/manager.js";

const serverSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/, "lowercase alphanumeric, dash, underscore only"),
  type: z.enum(["stdio", "sse"]),
  command: z.string().optional().nullable(),
  url: z.string().url().optional().nullable(),
  env: z.record(z.string()).optional().default({}),
});

export async function registerMCPRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/mcp", async () => {
    return { servers: await listMCPServers() };
  });

  app.post("/api/mcp", async (req, reply) => {
    const body = serverSchema.parse(req.body);
    if (body.type === "stdio" && !body.command) {
      reply.code(400); return { error: "stdio requires command" };
    }
    if (body.type === "sse" && !body.url) {
      reply.code(400); return { error: "sse requires url" };
    }
    const server = await createMCPServer({
      name: body.name,
      type: body.type,
      command: body.command ?? null,
      url: body.url ?? null,
      env: body.env ?? {},
    });
    await reloadMCP(server);
    return { server };
  });

  app.put("/api/mcp/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = serverSchema.partial().parse(req.body);
    const updated = await updateMCPServer(id, {
      ...body,
      command: body.command ?? undefined,
      url: body.url ?? undefined,
    });
    if (!updated) { reply.code(404); return { error: "not found" }; }
    await reloadMCP(updated);
    return { server: updated };
  });

  app.patch("/api/mcp/:id/enabled", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const updated = await updateMCPServer(id, { enabled });
    if (!updated) { reply.code(404); return { error: "not found" }; }
    if (enabled) {
      await reloadMCP(updated);
    } else {
      await removeMCPClient(id);
    }
    return { server: updated };
  });

  app.delete("/api/mcp/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await getMCPServer(id);
    if (!existing) { reply.code(404); return { error: "not found" }; }
    await removeMCPClient(id);
    await deleteMCPServer(id);
    return { ok: true };
  });
}
