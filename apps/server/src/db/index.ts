import { neon, neonConfig, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config.js";
import { logger } from "../util/logger.js";
import { incCounter } from "../util/metrics.js";

// When DATABASE_URL points at a local Neon compute (compose service name),
// re-route HTTP /sql calls and disable secure-WS. Bypassed for cloud Neon
// DSNs because NEON_FETCH_ENDPOINT is only set inside docker-compose.
if (process.env.NEON_FETCH_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
  neonConfig.useSecureWebSocket = false;
  neonConfig.poolQueryViaFetch = true;
}

const _sql = neon(config.DATABASE_URL);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 600;

function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("fetch failed") || msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT") || msg.includes("connecting to database");
}

// Wraps the neon tagged-template function with exponential-backoff retry.
// All repos use sql`...` directly, so retrying here covers every query.
async function sqlWithRetry(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await (_sql as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>)(strings, ...values);
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

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await _sql(text, params);
      return result as T[];
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
