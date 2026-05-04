import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import type { TelegramClient } from "telegram";
import type { Reminder } from "@tele/shared";
import {
  listReminders,
  markFired,
  setNextFireAt,
} from "../db/repos/reminders.js";
import { getChatById } from "../db/repos/chats.js";
import { sendReply } from "../telegram/sender.js";
import { eventBus } from "../util/eventBus.js";
import { logger } from "../util/logger.js";

interface Job {
  cron?: cron.ScheduledTask;
  timeout?: NodeJS.Timeout;
}

const jobs = new Map<string, Job>();

function nextCronDate(expr: string): Date | null {
  try {
    return CronExpressionParser.parse(expr).next().toDate();
  } catch {
    return null;
  }
}

async function fire(reminder: Reminder, oneShot: boolean): Promise<void> {
  const chat = await getChatById(reminder.target_chat_id);
  if (!chat) {
    logger.warn("reminder fired for missing chat", { id: reminder.id });
    return;
  }
  try {
    await sendReply(chat, reminder.message, "ai");
    eventBus.emit({ type: "reminder:fired", payload: { reminder } });
  } catch (err) {
    logger.error("reminder send failed", {
      id: reminder.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  if (oneShot) {
    await markFired(reminder.id);
    unscheduleReminder(reminder.id);
  } else if (reminder.cron_expr) {
    const next = nextCronDate(reminder.cron_expr);
    await setNextFireAt(reminder.id, next);
  }
}

export function scheduleReminder(reminder: Reminder): void {
  unscheduleReminder(reminder.id);
  if (!reminder.active) return;

  if (reminder.cron_expr) {
    if (!cron.validate(reminder.cron_expr)) {
      logger.warn("invalid cron expression", { id: reminder.id, expr: reminder.cron_expr });
      return;
    }
    const next = nextCronDate(reminder.cron_expr);
    void setNextFireAt(reminder.id, next);
    const task = cron.schedule(reminder.cron_expr, () => {
      void fire(reminder, false);
    });
    jobs.set(reminder.id, { cron: task });
    return;
  }

  if (reminder.fire_at) {
    const fireTime = new Date(reminder.fire_at).getTime();
    const delta = fireTime - Date.now();
    if (delta <= 0) {
      void fire(reminder, true);
      return;
    }
    const MAX_TIMEOUT = 2_147_483_000;
    const t = setTimeout(() => {
      void fire(reminder, true);
    }, Math.min(delta, MAX_TIMEOUT));
    jobs.set(reminder.id, { timeout: t });
    void setNextFireAt(reminder.id, new Date(fireTime));
  }
}

export function unscheduleReminder(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.cron) job.cron.stop();
  if (job.timeout) clearTimeout(job.timeout);
  jobs.delete(id);
}

export async function startScheduler(_client: TelegramClient): Promise<void> {
  const reminders = await listReminders(true);
  for (const r of reminders) {
    if (r.fired) continue;
    scheduleReminder(r);
  }
  logger.info("scheduler ready", { active: reminders.length });
}
