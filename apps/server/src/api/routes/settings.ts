import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getSettings, updateSettings } from "../../db/repos/settings.js";

const settingsSchema = z
  .object({
    auto_reply_enabled: z.boolean(),
    persona: z.string(),
    user_name: z.string(),
    temperature: z.number().min(0).max(2),
    gemini_model: z.string(),
    workspace_root: z.string(),
    shell_allow: z.array(z.string()),
    shell_deny: z.array(z.string()),
    reply_delay_ms: z.number().int().min(0).max(60_000),
    bot_prefix: z.string(),
    reaction_thinking: z.string(),
    reaction_done: z.string(),
  })
  .partial();

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => {
    return { settings: await getSettings() };
  });

  app.put("/api/settings", async (req) => {
    const body = settingsSchema.parse(req.body);
    return { settings: await updateSettings(body) };
  });
}
