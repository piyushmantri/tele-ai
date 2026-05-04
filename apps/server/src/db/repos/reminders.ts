import type { Reminder } from "@tele/shared";
import { query } from "../index.js";

export async function listReminders(activeOnly = false): Promise<Reminder[]> {
  if (activeOnly) {
    return query<Reminder>(`
      SELECT r.id, r.target_chat_id, r.message, r.cron_expr, r.fire_at, r.source,
             r.active, r.fired, r.next_fire_at, r.created_at,
             c.first_name AS contact_first_name, c.last_name AS contact_last_name,
             c.username AS contact_username, c.tg_chat_id::text AS contact_tg_chat_id
        FROM reminders r
        LEFT JOIN chats c ON c.id = r.target_chat_id
       WHERE r.active = TRUE
       ORDER BY r.created_at DESC
    `);
  }
  return query<Reminder>(`
    SELECT r.id, r.target_chat_id, r.message, r.cron_expr, r.fire_at, r.source,
           r.active, r.fired, r.next_fire_at, r.created_at,
           c.first_name AS contact_first_name, c.last_name AS contact_last_name,
           c.username AS contact_username, c.tg_chat_id::text AS contact_tg_chat_id
      FROM reminders r
      LEFT JOIN chats c ON c.id = r.target_chat_id
     ORDER BY r.created_at DESC
  `);
}

export async function getReminder(id: string): Promise<Reminder | null> {
  const rows = await query<Reminder>(
    `SELECT r.id, r.target_chat_id, r.message, r.cron_expr, r.fire_at, r.source,
            r.active, r.fired, r.next_fire_at, r.created_at,
            c.first_name AS contact_first_name, c.last_name AS contact_last_name,
            c.username AS contact_username, c.tg_chat_id::text AS contact_tg_chat_id
       FROM reminders r
       LEFT JOIN chats c ON c.id = r.target_chat_id
      WHERE r.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createReminder(input: {
  target_chat_id: string;
  message: string;
  cron_expr: string | null;
  fire_at: string | null;
  source: "ai" | "user";
}): Promise<Reminder> {
  const rows = await query<Reminder>(
    `INSERT INTO reminders (target_chat_id, message, cron_expr, fire_at, source, next_fire_at)
     VALUES ($1, $2, $3, $4, $5, $4)
     RETURNING id, target_chat_id, message, cron_expr, fire_at, source,
               active, fired, next_fire_at, created_at`,
    [input.target_chat_id, input.message, input.cron_expr, input.fire_at, input.source],
  );
  return rows[0]!;
}

export async function markFired(id: string): Promise<void> {
  await query(`UPDATE reminders SET fired = TRUE, active = FALSE WHERE id = $1`, [id]);
}

export async function setNextFireAt(id: string, at: Date | null): Promise<void> {
  await query(`UPDATE reminders SET next_fire_at = $2 WHERE id = $1`, [id, at ? at.toISOString() : null]);
}

export async function deactivateReminder(id: string): Promise<void> {
  await query(`UPDATE reminders SET active = FALSE WHERE id = $1`, [id]);
}
