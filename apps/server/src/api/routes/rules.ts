import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRule, deleteRule, listRules } from "../../db/repos/rules.js";

export async function registerRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/rules", async () => {
    return { rules: await listRules() };
  });

  app.post("/api/rules", async (req) => {
    const body = z
      .object({
        type: z.enum(["allow", "block"]),
        match: z.string().min(1),
        note: z.string().optional(),
      })
      .parse(req.body);
    const rule = await createRule({
      type: body.type,
      match: body.match,
      note: body.note ?? null,
    });
    return { rule };
  });

  app.delete("/api/rules/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await deleteRule(params.id);
    return { ok: true };
  });
}
