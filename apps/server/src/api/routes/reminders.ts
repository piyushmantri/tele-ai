import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createReminder,
  deactivateReminder,
  listReminders,
} from "../../db/repos/reminders.js";
import { scheduleReminder, unscheduleReminder } from "../../scheduler/index.js";

export async function registerReminderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/reminders", async () => {
    return { reminders: await listReminders(false) };
  });

  app.post("/api/reminders", async (req, reply) => {
    const body = z
      .object({
        target_chat_id: z.string().uuid(),
        message: z.string().min(1),
        cron_expr: z.string().optional(),
        fire_at: z.string().datetime().optional(),
      })
      .parse(req.body);
    if (!body.cron_expr && !body.fire_at) {
      reply.code(400);
      return { error: "either cron_expr or fire_at is required" };
    }
    const reminder = await createReminder({
      target_chat_id: body.target_chat_id,
      message: body.message,
      cron_expr: body.cron_expr ?? null,
      fire_at: body.fire_at ?? null,
      source: "user",
    });
    scheduleReminder(reminder);
    return { reminder };
  });

  app.delete("/api/reminders/:id", async (req) => {
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    await deactivateReminder(params.id);
    unscheduleReminder(params.id);
    return { ok: true };
  });
}
