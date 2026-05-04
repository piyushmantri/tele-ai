import type { ToolAuditEntry } from "@tele/shared";
import { sql } from "../index.js";

export async function logToolCall(input: {
  chat_id: string | null;
  tool_name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
}): Promise<ToolAuditEntry> {
  const rows = (await sql`
    INSERT INTO tool_audit_log (chat_id, tool_name, args, result, ok)
    VALUES (${input.chat_id}, ${input.tool_name},
            ${JSON.stringify(input.args)}::jsonb,
            ${JSON.stringify(input.result)}::jsonb,
            ${input.ok})
    RETURNING id, chat_id, tool_name, args, result, ok, created_at
  `) as ToolAuditEntry[];
  return rows[0]!;
}

export async function listAudit(limit = 100): Promise<ToolAuditEntry[]> {
  const rows = (await sql`
    SELECT id, chat_id, tool_name, args, result, ok, created_at
      FROM tool_audit_log
     ORDER BY created_at DESC
     LIMIT ${limit}
  `) as ToolAuditEntry[];
  return rows;
}
