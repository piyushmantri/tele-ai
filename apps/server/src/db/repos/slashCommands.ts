import type { SlashCommand, SlashCommandType } from "@tele/shared";
import { query } from "../index.js";

export async function listSlashCommands(): Promise<SlashCommand[]> {
  return query<SlashCommand>(
    `SELECT id, name, description, type, action, enabled, created_at FROM slash_commands ORDER BY created_at ASC`,
  );
}

export async function getSlashCommand(id: string): Promise<SlashCommand | null> {
  const rows = await query<SlashCommand>(
    `SELECT id, name, description, type, action, enabled, created_at FROM slash_commands WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getSlashCommandByName(name: string): Promise<SlashCommand | null> {
  const rows = await query<SlashCommand>(
    `SELECT id, name, description, type, action, enabled, created_at FROM slash_commands WHERE name = $1`,
    [name],
  );
  return rows[0] ?? null;
}

export async function createSlashCommand(input: {
  name: string;
  description?: string;
  type: SlashCommandType;
  action: string;
}): Promise<SlashCommand> {
  const rows = await query<SlashCommand>(
    `INSERT INTO slash_commands (name, description, type, action)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, type, action, enabled, created_at`,
    [input.name, input.description ?? "", input.type, input.action],
  );
  return rows[0]!;
}

export async function updateSlashCommand(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    type: SlashCommandType;
    action: string;
    enabled: boolean;
  }>,
): Promise<SlashCommand | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    sets.push(`name = $${i++}`);
    vals.push(patch.name);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "description")) {
    sets.push(`description = $${i++}`);
    vals.push(patch.description);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "type")) {
    sets.push(`type = $${i++}`);
    vals.push(patch.type);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "action")) {
    sets.push(`action = $${i++}`);
    vals.push(patch.action);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    sets.push(`enabled = $${i++}`);
    vals.push(patch.enabled);
  }
  if (sets.length === 0) return getSlashCommand(id);
  vals.push(id);
  const rows = await query<SlashCommand>(
    `UPDATE slash_commands SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, description, type, action, enabled, created_at`,
    vals,
  );
  return rows[0] ?? null;
}

export async function deleteSlashCommand(id: string): Promise<void> {
  await query(`DELETE FROM slash_commands WHERE id = $1`, [id]);
}
