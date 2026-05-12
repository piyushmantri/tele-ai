import type { TelegramBotConfig, UpdateTelegramBotConfigBody } from "@tele/shared";
import { query } from "../index.js";

const COLUMNS = "id, token, system_prompt, enabled, created_at";

export async function getTelegramBotConfig(): Promise<TelegramBotConfig | null> {
  const rows = await query<TelegramBotConfig>(
    `SELECT ${COLUMNS} FROM telegram_bot_config LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function setTelegramBotConfig(
  patch: UpdateTelegramBotConfigBody,
): Promise<TelegramBotConfig> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(patch, k);
  if (!has("token") && !has("system_prompt") && !has("enabled")) {
    throw new Error("empty patch");
  }

  const existing = await getTelegramBotConfig();
  if (!existing) {
    if (!has("token") || !patch.token) {
      throw new Error("token required for first-time write");
    }
    const rows = await query<TelegramBotConfig>(
      `INSERT INTO telegram_bot_config (token, system_prompt, enabled)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [
        patch.token,
        has("system_prompt") ? (patch.system_prompt ?? "") : "",
        has("enabled") ? Boolean(patch.enabled) : true,
      ],
    );
    return rows[0]!;
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (has("token")) {
    sets.push(`token = $${i++}`);
    vals.push(patch.token);
  }
  if (has("system_prompt")) {
    sets.push(`system_prompt = $${i++}`);
    vals.push(patch.system_prompt ?? "");
  }
  if (has("enabled")) {
    sets.push(`enabled = $${i++}`);
    vals.push(Boolean(patch.enabled));
  }
  vals.push(existing.id);
  const rows = await query<TelegramBotConfig>(
    `UPDATE telegram_bot_config SET ${sets.join(", ")} WHERE id = $${i} RETURNING ${COLUMNS}`,
    vals,
  );
  return rows[0]!;
}

export async function clearTelegramBotConfig(): Promise<void> {
  await query(`DELETE FROM telegram_bot_config`, []);
}

export async function setEnabled(enabled: boolean): Promise<TelegramBotConfig> {
  const rows = await query<TelegramBotConfig>(
    `UPDATE telegram_bot_config SET enabled = $1 RETURNING ${COLUMNS}`,
    [enabled],
  );
  if (!rows[0]) throw new Error("no telegram_bot_config row to update");
  return rows[0];
}
