import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./index.js";
import { logger } from "../util/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )`;

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = (await sql`SELECT filename FROM schema_migrations`) as Array<{
    filename: string;
  }>;
  const appliedSet = new Set(applied.map((r) => r.filename));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    logger.info("applying migration", { file });
    const text = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    // Run each non-empty statement individually (Neon serverless has no sql.unsafe).
    // Strip `--` line comments before splitting so semicolons inside comments don't crash.
    // All DDL uses IF NOT EXISTS so re-runs are safe.
    const statements = text
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await sql(stmt + ";", []);
    }
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    logger.info("migration applied", { file });
  }
}
