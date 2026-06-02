import { query } from "../index.js";

// Local row type — mirrored in @tele/shared as ApplicationRegistryRow
// (executor-b writes the shared type; we keep a structurally-identical local
// copy here so this repo is independent of build order). Field names match
// the SQL columns 1-1.
export interface ApplicationRegistryRow {
  id: string;
  slug: string;
  source_type: "git" | "local";
  source_url: string | null;
  source_path: string | null;
  created_at: string;
}

const COLS = "id, slug, source_type, source_url, source_path, created_at";

export async function listRegistryRows(): Promise<ApplicationRegistryRow[]> {
  return query<ApplicationRegistryRow>(
    `SELECT ${COLS} FROM application_registry ORDER BY slug ASC`,
  );
}

export async function getRegistryRowBySlug(
  slug: string,
): Promise<ApplicationRegistryRow | null> {
  const rows = await query<ApplicationRegistryRow>(
    `SELECT ${COLS} FROM application_registry WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function createRegistryRow(input: {
  slug: string;
  source_type: "git" | "local";
  source_url?: string | null;
  source_path?: string | null;
}): Promise<ApplicationRegistryRow> {
  const rows = await query<ApplicationRegistryRow>(
    `INSERT INTO application_registry (slug, source_type, source_url, source_path)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLS}`,
    [
      input.slug,
      input.source_type,
      input.source_url ?? null,
      input.source_path ?? null,
    ],
  );
  return rows[0]!;
}

export async function deleteRegistryRow(slug: string): Promise<void> {
  await query(`DELETE FROM application_registry WHERE slug = $1`, [slug]);
}
