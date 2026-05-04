import type { Rule } from "@tele/shared";
import { sql } from "../index.js";

export async function listRules(): Promise<Rule[]> {
  const rows = (await sql`
    SELECT id, type, match, note, created_at
      FROM contact_rules
      ORDER BY created_at DESC
  `) as Rule[];
  return rows;
}

export async function createRule(input: {
  type: "allow" | "block";
  match: string;
  note: string | null;
}): Promise<Rule> {
  const rows = (await sql`
    INSERT INTO contact_rules (type, match, note)
    VALUES (${input.type}, ${input.match}, ${input.note})
    RETURNING id, type, match, note, created_at
  `) as Rule[];
  return rows[0]!;
}

export async function deleteRule(id: string): Promise<void> {
  await sql`DELETE FROM contact_rules WHERE id = ${id}`;
}

export async function isBlocked(opts: {
  username: string | null;
  tg_chat_id: bigint | string;
}): Promise<boolean> {
  const matches = [String(opts.tg_chat_id), opts.username].filter(
    (v): v is string => Boolean(v),
  );
  if (matches.length === 0) return false;
  const rows = (await sql`
    SELECT 1 FROM contact_rules
     WHERE type = 'block' AND match = ANY(${matches})
     LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}
