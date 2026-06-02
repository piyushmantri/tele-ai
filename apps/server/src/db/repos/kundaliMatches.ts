import { makeSql } from "../index.js";

export interface KundaliMatchRow {
  id: string;
  data: Record<string, unknown>;
  created_at: string;
}

export async function listKundaliMatches(
  databaseUrl: string,
  limit = 50,
): Promise<KundaliMatchRow[]> {
  const sql = makeSql(databaseUrl);
  const rows = await sql(
    `SELECT id, data, created_at FROM kundali_matches ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows as KundaliMatchRow[];
}
