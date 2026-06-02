// Generic per-app DB helper for code-type applications with a `database_url`.
//
// ensureAppMigrated(installedPath, databaseUrl) — reads migration files from
// <installedPath>/src/db/migrations/*.sql (sorted), tracks applied ones in
// schema_migrations (same pattern as counseller's migrate.ts), and runs any
// pending ones on the application's external Neon DB. In-process memo keyed
// by "installedPath:databaseUrl" so repeated calls within one process lifetime
// are no-ops. Missing migrations dir is silently skipped (no schema = fine).
//
// makeStoreResult(applicationId, databaseUrl, installedPath) — returns a
// fire-and-forget callback for the hook's ctx.storeResult. Runs migrations on
// first call, then inserts data into the kundali_matches table. Swallows all
// errors; callers should fire-and-forget via void storeResult({...}).catch(()=>{}).

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../util/logger.js";

const clientCache = new Map<string, NeonQueryFunction<false, false>>();
const migratedKeys = new Set<string>(); // "<installedPath>:<databaseUrl>"

function externalClient(url: string): NeonQueryFunction<false, false> {
  let c = clientCache.get(url);
  if (!c) {
    c = neon(url) as NeonQueryFunction<false, false>;
    clientCache.set(url, c);
  }
  return c;
}

export async function ensureAppMigrated(
  installedPath: string,
  databaseUrl: string,
): Promise<void> {
  const key = `${installedPath}:${databaseUrl}`;
  if (migratedKeys.has(key)) return;
  const sql = externalClient(databaseUrl);
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`;
  const migrationsDir = join(installedPath, "src", "db", "migrations");
  let files: string[];
  try {
    files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    migratedKeys.add(key);
    return;
  }
  const appliedRows = await sql`SELECT filename FROM schema_migrations`;
  const applied = new Set(appliedRows.map((r) => r.filename as string));
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(join(migrationsDir, file), "utf8");
    const statements = text
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await sql(stmt + ";", []);
    }
    await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`;
  }
  migratedKeys.add(key);
}

export function makeStoreResult(
  applicationId: string,
  databaseUrl: string | null | undefined,
  installedPath: string | null | undefined,
): (data: Record<string, unknown>) => Promise<void> {
  return async (data: Record<string, unknown>): Promise<void> => {
    if (!databaseUrl) return;
    try {
      const sql = externalClient(databaseUrl);
      if (installedPath) await ensureAppMigrated(installedPath, databaseUrl);
      await sql`INSERT INTO kundali_matches (data) VALUES (${JSON.stringify(data)}::jsonb)`;
    } catch (err) {
      logger.warn("storeResult failed", {
        applicationId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function externalDbClient(url: string): NeonQueryFunction<false, false> {
  return externalClient(url);
}
