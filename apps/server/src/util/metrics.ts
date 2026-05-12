// Core in-memory metrics module. Pure JS state — no DB, no logger, no telegram imports
// (avoids circular imports). Only depends on @tele/shared types and ./influx.js.
//
// Three maps + one bounded ring:
// - counters: monotonic event counters
// - gauges: instantaneous values (e.g. ws subscribers)
// - histograms: ring of last 1024 values per metric, sorted on read for percentiles
// - errorBuckets: bounded map of last 100 unique (level:source) buckets
//
// Persistence (decision #17): persistToInflux() writes a Point per item every 60s;
// loadLatestFromInflux() restores counters/gauges/errors on boot. Histogram rings
// stay fresh per restart (summaries still queryable via the timeseries endpoint).
import type { ErrorBucket, HistogramSnapshot } from "@tele/shared";
import { writePoints, queryFlux, isConfigured, Point, configureMetrics } from "./influx.js";
import { config } from "../config.js";

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();
const errorBuckets = new Map<string, ErrorBucket>();

const HIST_RING_SIZE = 1024;
const ERROR_BUCKET_CAP = 100;
const startTime = Date.now();

export function incCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

// Wire influx-internal write callbacks to incCounter so influx.write.{ok,err,...}
// surface in /api/metrics. Function ref captured before first influx write.
configureMetrics(incCounter);

export function getCounters(): Record<string, number> {
  return Object.fromEntries(counters);
}

export function setGauge(name: string, value: number): void {
  gauges.set(name, value);
}

export function getGauges(): Record<string, number> {
  return Object.fromEntries(gauges);
}

export function recordHistogram(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  let ring = histograms.get(name);
  if (!ring) {
    ring = [];
    histograms.set(name, ring);
  }
  ring.push(value);
  if (ring.length > HIST_RING_SIZE) ring.shift();
}

function summarize(values: number[]): HistogramSnapshot {
  const n = values.length;
  if (n === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))]!;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: n,
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[n - 1]!,
    mean: sum / n,
  };
}

export function getHistograms(): Record<string, HistogramSnapshot> {
  const out: Record<string, HistogramSnapshot> = {};
  for (const [name, ring] of histograms) {
    out[name] = summarize(ring);
  }
  return out;
}

export function markError(level: "warn" | "error", msg: string, _extra?: unknown): void {
  const source = msg.slice(0, 80);
  const key = `${level}:${source}`;
  const now = new Date().toISOString();
  const existing = errorBuckets.get(key);
  if (existing) {
    existing.count++;
    existing.last_seen = now;
  } else {
    if (errorBuckets.size >= ERROR_BUCKET_CAP) {
      // Drop oldest by last_seen.
      let oldestKey: string | null = null;
      let oldestSeen = "9999-99-99";
      for (const [k, b] of errorBuckets) {
        if (b.last_seen < oldestSeen) {
          oldestSeen = b.last_seen;
          oldestKey = k;
        }
      }
      if (oldestKey) errorBuckets.delete(oldestKey);
    }
    errorBuckets.set(key, { level, source, message: source, count: 1, last_seen: now });
  }
}

export function getRecentErrors(limit = 20): ErrorBucket[] {
  return [...errorBuckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function getStartTime(): number {
  return startTime;
}

export function snapshotAll(): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramSnapshot>;
  errors: ErrorBucket[];
} {
  return {
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(gauges),
    histograms: getHistograms(),
    errors: [...errorBuckets.values()],
  };
}

export function restoreFromMaps(input: {
  counters?: Record<string, number>;
  gauges?: Record<string, number>;
  errors?: ErrorBucket[];
}): void {
  if (input.counters) {
    for (const [k, v] of Object.entries(input.counters)) counters.set(k, v);
  }
  if (input.gauges) {
    for (const [k, v] of Object.entries(input.gauges)) gauges.set(k, v);
  }
  if (input.errors) {
    for (const e of input.errors) {
      errorBuckets.set(`${e.level}:${e.source}`, e);
    }
  }
}

export async function persistToInflux(): Promise<void> {
  if (!isConfigured()) return;
  const snap = snapshotAll();
  const t = new Date();
  const points: Point[] = [];
  for (const [name, value] of Object.entries(snap.counters)) {
    points.push(new Point("tele_counter").tag("name", name).intField("value", value).timestamp(t));
  }
  for (const [name, value] of Object.entries(snap.gauges)) {
    points.push(new Point("tele_gauge").tag("name", name).floatField("value", value).timestamp(t));
  }
  for (const [name, h] of Object.entries(snap.histograms)) {
    points.push(
      new Point("tele_histogram")
        .tag("name", name)
        .intField("count", h.count)
        .floatField("p50", h.p50)
        .floatField("p95", h.p95)
        .floatField("p99", h.p99)
        .floatField("max", h.max)
        .floatField("mean", h.mean)
        .timestamp(t),
    );
  }
  for (const e of snap.errors) {
    points.push(
      new Point("tele_error")
        .tag("level", e.level)
        .tag("source", e.source)
        .intField("count", e.count)
        .timestamp(t),
    );
  }
  writePoints(points);
}

export async function loadLatestFromInflux(): Promise<void> {
  if (!isConfigured()) return;
  const bucket = config.INFLUXDB_BUCKET;
  if (!bucket) return;
  const query = `from(bucket: "${bucket}")
    |> range(start: -1d)
    |> filter(fn: (r) =>
         r._measurement == "tele_counter" or
         r._measurement == "tele_gauge" or
         r._measurement == "tele_error")
    |> last()`;

  const restoredCounters: Record<string, number> = {};
  const restoredGauges: Record<string, number> = {};
  const restoredErrors: ErrorBucket[] = [];

  for await (const row of queryFlux(query)) {
    const measurement = row["_measurement"] as string | undefined;
    const value = row["_value"];
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) continue;
    if (measurement === "tele_counter") {
      const name = row["name"] as string | undefined;
      if (name) restoredCounters[name] = numeric;
    } else if (measurement === "tele_gauge") {
      const name = row["name"] as string | undefined;
      if (name) restoredGauges[name] = numeric;
    } else if (measurement === "tele_error") {
      const level = row["level"] as "warn" | "error" | undefined;
      const source = row["source"] as string | undefined;
      const time = row["_time"] as string | undefined;
      if (level && source) {
        restoredErrors.push({
          level,
          source,
          message: source,
          count: numeric,
          last_seen: time ?? new Date().toISOString(),
        });
      }
    }
  }

  restoreFromMaps({
    counters: restoredCounters,
    gauges: restoredGauges,
    errors: restoredErrors,
  });
}
