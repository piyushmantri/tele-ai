// InfluxDB Cloud v2 wrapper. Optional persistence layer for the metrics module.
// When env vars are absent (any of the 4 INFLUXDB_*), all exports become no-ops.
// Bucket retention is configured server-side in the InfluxDB Cloud UI (default 30d
// on free tier); this code never deletes points.
//
// Note: NO import of ./logger.js — that would create a cycle
// (logger → metrics → influx → logger). Errors here are surfaced via console
// directly. Initialization is lazy via ensureInit() so config-time issues do
// not throw at module load.
import { InfluxDB, Point, type WriteApi, type QueryApi } from "@influxdata/influxdb-client";
import { config } from "../config.js";

let writeApi: WriteApi | null = null;
let queryApi: QueryApi | null = null;
let lastWriteAt: string | null = null;
let initialized = false;

// Setter-injected counter to avoid cycle (logger → metrics → influx → metrics).
let incCounterFn: ((name: string, by?: number) => void) | null = null;
export function configureMetrics(fn: (name: string, by?: number) => void): void {
  incCounterFn = fn;
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  const url = config.INFLUXDB_URL;
  const token = config.INFLUXDB_TOKEN;
  const org = config.INFLUXDB_ORG;
  const bucket = config.INFLUXDB_BUCKET;
  if (url && token && org && bucket) {
    const client = new InfluxDB({ url, token, timeout: 30_000 });
    writeApi = client.getWriteApi(org, bucket, "ms", {
      flushInterval: 5_000,
      batchSize: 500,
      maxRetries: 5,
      retryJitter: 1000,
      writeFailed: (err, lines, attempt) => {
        incCounterFn?.("influx.write.err");
        incCounterFn?.(`influx.write.attempt.${Math.min(attempt, 5)}`);
        // eslint-disable-next-line no-console
        console.warn(
          JSON.stringify({
            t: new Date().toISOString(),
            level: "warn",
            msg: "influx write failed",
            attempt,
            err: err instanceof Error ? err.message : String(err),
            lineCount: lines.length,
          }),
        );
      },
      writeSuccess: (lines) => {
        incCounterFn?.("influx.write.ok");
        incCounterFn?.("influx.write.lines", lines.length);
        lastWriteAt = new Date().toISOString();
      },
    });
    queryApi = client.getQueryApi(org);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        level: "info",
        msg: "influx configured",
        url,
        org,
        bucket,
      }),
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        level: "info",
        msg: "influx not configured — metrics persistence disabled",
      }),
    );
  }
}

export function isConfigured(): boolean {
  ensureInit();
  return writeApi !== null;
}

export function writePoints(points: Point[]): void {
  ensureInit();
  if (!writeApi || points.length === 0) return;
  writeApi.writePoints(points);
}

export interface FluxRow {
  values: string[];
  tableMeta: { toObject(values: string[]): Record<string, unknown> };
}

export async function* queryFlux(query: string): AsyncIterable<Record<string, unknown>> {
  ensureInit();
  if (!queryApi) throw new Error("influx not configured");
  const iter = queryApi.iterateRows(query);
  for await (const { values, tableMeta } of iter as AsyncIterable<FluxRow>) {
    yield tableMeta.toObject(values);
  }
}

export async function flush(): Promise<void> {
  ensureInit();
  if (!writeApi) return;
  await writeApi.flush();
}

export function getLastWriteAt(): string | null {
  return lastWriteAt;
}

export { Point };
