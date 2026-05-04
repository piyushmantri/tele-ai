import type { Skill } from "@tele/shared";
import { query } from "../index.js";

export async function listSkills(): Promise<Skill[]> {
  return query<Skill>(
    `SELECT id, name, description, content, path, enabled, created_at FROM skills ORDER BY created_at ASC`,
  );
}

export async function getSkill(id: string): Promise<Skill | null> {
  const rows = await query<Skill>(
    `SELECT id, name, description, content, path, enabled, created_at FROM skills WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getSkillByName(name: string): Promise<Skill | null> {
  const rows = await query<Skill>(
    `SELECT id, name, description, content, path, enabled, created_at FROM skills WHERE name = $1`,
    [name],
  );
  return rows[0] ?? null;
}

export async function createSkill(input: {
  name: string;
  description?: string;
  content?: string;
  path?: string | null;
}): Promise<Skill> {
  const rows = await query<Skill>(
    `INSERT INTO skills (name, description, content, path)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, description, content, path, enabled, created_at`,
    [
      input.name,
      input.description ?? "",
      input.content ?? "",
      input.path ?? null,
    ],
  );
  return rows[0]!;
}

export async function updateSkill(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    content: string;
    path: string | null;
    enabled: boolean;
  }>,
): Promise<Skill | null> {
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
  if (Object.prototype.hasOwnProperty.call(patch, "content")) {
    sets.push(`content = $${i++}`);
    vals.push(patch.content);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "path")) {
    sets.push(`path = $${i++}`);
    vals.push(patch.path);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    sets.push(`enabled = $${i++}`);
    vals.push(patch.enabled);
  }
  if (sets.length === 0) return getSkill(id);
  vals.push(id);
  const rows = await query<Skill>(
    `UPDATE skills SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, description, content, path, enabled, created_at`,
    vals,
  );
  return rows[0] ?? null;
}

export async function deleteSkill(id: string): Promise<void> {
  await query(`DELETE FROM skills WHERE id = $1`, [id]);
}
