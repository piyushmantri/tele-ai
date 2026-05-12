import type { Settings } from "@tele/shared";
import { sql } from "../index.js";

const KEY = "app";

const DEFAULTS: Settings = {
  auto_reply_enabled: true,
  persona:
    "You are the user's personal AI assistant operating their Telegram account. Reply briefly, in the user's casual tone, never mention being an AI unless directly asked.",
  user_name: "User",
  ai_username: "woody",
  temperature: 0.7,
  gemini_model: "gemini-3-flash-preview",
  workspace_root: "/Users/piyush.mantri/spaps/tele/workspace",
  shell_allow: ["ls", "df", "du", "echo", "pwd", "cat", "head", "tail", "wc", "uptime", "whoami", "date"],
  shell_deny: ["rm", "sudo", "mkfs", "dd", ":(){", "curl|sh", "wget"],
  reply_delay_ms: 1500,
  bot_prefix: "[Woody]",
  reaction_thinking: "👀",
  reaction_done: "👍",
};

export async function getSettings(): Promise<Settings> {
  const rows = (await sql`SELECT value FROM settings WHERE key = ${KEY}`) as Array<{
    value: Settings;
  }>;
  if (rows.length === 0) {
    await sql`INSERT INTO settings (key, value) VALUES (${KEY}, ${JSON.stringify(
      DEFAULTS,
    )}::jsonb)`;
    return DEFAULTS;
  }
  return { ...DEFAULTS, ...rows[0]!.value };
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${KEY}, ${JSON.stringify(next)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return next;
}
