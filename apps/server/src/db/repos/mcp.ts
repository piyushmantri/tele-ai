import type { MCPServer } from "@tele/shared";
import { query } from "../index.js";

export async function listMCPServers(): Promise<MCPServer[]> {
  return query<MCPServer>(`SELECT id, name, type, command, url, env, enabled, created_at FROM mcp_servers ORDER BY created_at ASC`);
}

export async function getMCPServer(id: string): Promise<MCPServer | null> {
  const rows = await query<MCPServer>(`SELECT id, name, type, command, url, env, enabled, created_at FROM mcp_servers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createMCPServer(input: {
  name: string;
  type: "stdio" | "sse";
  command: string | null;
  url: string | null;
  env: Record<string, string>;
}): Promise<MCPServer> {
  const rows = await query<MCPServer>(
    `INSERT INTO mcp_servers (name, type, command, url, env)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, type, command, url, env, enabled, created_at`,
    [input.name, input.type, input.command, input.url, JSON.stringify(input.env)],
  );
  return rows[0]!;
}

export async function updateMCPServer(
  id: string,
  input: Partial<{ name: string; type: "stdio" | "sse"; command: string | null; url: string | null; env: Record<string, string>; enabled: boolean }>,
): Promise<MCPServer | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); vals.push(input.name); }
  if (input.type !== undefined) { sets.push(`type = $${i++}`); vals.push(input.type); }
  if (input.command !== undefined) { sets.push(`command = $${i++}`); vals.push(input.command); }
  if (input.url !== undefined) { sets.push(`url = $${i++}`); vals.push(input.url); }
  if (input.env !== undefined) { sets.push(`env = $${i++}`); vals.push(JSON.stringify(input.env)); }
  if (input.enabled !== undefined) { sets.push(`enabled = $${i++}`); vals.push(input.enabled); }
  if (sets.length === 0) return getMCPServer(id);
  vals.push(id);
  const rows = await query<MCPServer>(
    `UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = $${i} RETURNING id, name, type, command, url, env, enabled, created_at`,
    vals,
  );
  return rows[0] ?? null;
}

export async function deleteMCPServer(id: string): Promise<void> {
  await query(`DELETE FROM mcp_servers WHERE id = $1`, [id]);
}
