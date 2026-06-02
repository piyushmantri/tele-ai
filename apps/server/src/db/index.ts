import pg from "pg";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";
import type { NeonQueryFunction } from "@neondatabase/serverless";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL });

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 600;

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as NodeJS.ErrnoException)?.code ?? "";
  return (
    msg.includes("fetch failed") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("connecting to database") ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT"
  );
}

// Wraps pg.Pool query with retry, exposing both tagged-template and
// parameterized-call signatures compatible with NeonQueryFunction.
async function sqlWithRetry(strings: TemplateStringsArray | string, ...values: unknown[]): Promise<unknown[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let text: string;
      let params: unknown[];
      if (typeof strings === "string") {
        // sql("SELECT...", params) form
        text = strings;
        params = (values[0] as unknown[]) ?? [];
      } else {
        // sql`SELECT * WHERE id = ${id}` tagged-template form
        text = (strings as TemplateStringsArray).reduce(
          (acc: string, str: string, i: number) => acc + (i > 0 ? `$${i}` : "") + str,
          "",
        );
        params = values;
      }
      const result = await pool.query(text, params);
      return result.rows;
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES - 1) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      incCounter("db.transient_retry");
      logger.warn("db transient error, retrying", {
        attempt: attempt + 1,
        delay_ms: delay,
        err: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const sql = sqlWithRetry as unknown as NeonQueryFunction<false, false>;

// Per-URL pool cache for external app databases (replaces neon(url))
const externalPools = new Map<string, pg.Pool>();

function makePoolQuery(pool: pg.Pool) {
  return async function sqlFn(strings: TemplateStringsArray | string, ...values: unknown[]): Promise<unknown[]> {
    let text: string;
    let params: unknown[];
    if (typeof strings === "string") {
      text = strings;
      params = (values[0] as unknown[]) ?? [];
    } else {
      text = (strings as TemplateStringsArray).reduce(
        (acc: string, str: string, i: number) => acc + (i > 0 ? `$${i}` : "") + str,
        "",
      );
      params = values;
    }
    const result = await pool.query(text, params);
    return result.rows;
  };
}

export function makeSql(url: string): NeonQueryFunction<false, false> {
  let p = externalPools.get(url);
  if (!p) {
    p = new Pool({ connectionString: url });
    externalPools.set(url, p);
  }
  return makePoolQuery(p) as unknown as NeonQueryFunction<false, false>;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await pool.query(text, params);
      return result.rows as T[];
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err) || attempt === MAX_RETRIES - 1) throw err;
      const delay = BASE_DELAY_MS * 2 ** attempt;
      incCounter("db.transient_retry");
      logger.warn("db transient error, retrying", { attempt: attempt + 1, delay_ms: delay, err: err instanceof Error ? err.message : String(err) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
