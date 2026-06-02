// PLUGIN BOUNDARY — plugins receive the emit closures via getContext /
// handleSlashCommand's ctx arg. They MUST NOT import from this file directly.
// Slug segment regex (caller-validated): /^[a-z0-9-]{1,64}$/. Custom-metric
// name segment regex: /^[a-z0-9_]{1,64}$/. Note that SLUGS allow hyphens
// (kundali-match) but CUSTOM NAMES do not.
//
// Cardinality discipline (lessons-2026-05-08): names compose as
// `app.<slug>.<event>[.<variant>][.<status>]`. Framework counters keep depth
// ≤ 4; the slash counter `slash.<cmd>.<status>` is the documented depth-5
// exception. Module-scoped Map + Set enforce per-slug name cap so a runaway
// plugin can't fill the in-memory metric registry. Every record path is
// wrapped in try/catch — metrics must NEVER throw out of the hook caller
// (defense-in-depth; outer per-item try/catch already exists in the hook
// dispatchers but the wrap here closes the residual gap).
//
// TYPED EMIT (2026-05-27): `makeAppEmit(slug)` returns
// `{ emit, emitTimeseries }`. `emit(name, value?)` increments a counter via
// `app.<slug>.custom.<name>`. `emitTimeseries(name, value)` records a
// timestamped point in an in-memory ring (240 samples per metric, ~2hr at
// 30s cadence). Timeseries names compose as `app.<slug>.ts.<name>` — depth
// 4, same shape as counters' `custom.<name>`. Cap is independent per type:
// 50 counters + 50 timeseries per slug. Timeseries are persisted to Influx
// via `persistAppTimeseries()` (incremental, called every 60s from index.ts)
// and restored on boot via `loadAppTimeseriesFromInflux()`. Each point is
// written with its actual timestamp so the line chart survives restarts.
// The counter restore path (`loadLatestFromInflux`) populates the counter Map
// directly and bypasses the per-slug name Set on the in-process side;
// accepted trade-off for v1 (R13).

import { incCounter, recordHistogram } from "../util/metrics.js";
import { logger } from "../util/logger.js";
import { isConfigured, writePoints, queryFlux, Point } from "../util/influx.js";
import { config } from "../config.js";

const MAX_CUSTOM_METRICS_PER_SLUG = 50;
const CUSTOM_NAME_REGEX = /^[a-z0-9_]{1,64}$/;
const TS_RING_SIZE = 240; // ~2hr @ 30s emit cadence

// Module-scoped state — process lifetime. customNamesPerSlug tracks which
// custom metric names this slug has registered (so we can cap the count).
// warnedOverCap doubles as the one-time-warn flag for both the cap-exceeded
// case AND the first-invalid-name case (reused per slug). tsWarnedOverCap
// is the parallel for timeseries names — independent so counters and ts cap
// warns are reported separately per slug.
const customNamesPerSlug = new Map<string, Set<string>>();
const warnedOverCap = new Set<string>();
const slashWarn = new Set<string>();
const tsPerSlug = new Map<string, Map<string, Array<{ t: number; v: number }>>>();
const tsNamesPerSlug = new Map<string, Set<string>>();
const tsWarnedOverCap = new Set<string>();

// Cursor for incremental Influx persist — only write points newer than this.
// Initialized to 0 so the first tick writes all in-memory points.
// Reset to Date.now() after loadAppTimeseriesFromInflux so restored points
// are not re-written on the first persist tick.
let tsPersistCursorMs = 0;

export function recordAppCall(slug: string, durationMs: number, ok: boolean): void {
  try {
    incCounter(`app.${slug}.call.${ok ? "ok" : "err"}`);
    recordHistogram(`app.${slug}.duration_ms`, durationMs);
  } catch (err) {
    try {
      logger.warn("app metric record failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // never let logger failure escape
    }
  }
}

export function recordAppSlash(slug: string, cmd: string, ok: boolean): void {
  try {
    if (!CUSTOM_NAME_REGEX.test(cmd)) {
      if (!slashWarn.has(slug)) {
        slashWarn.add(slug);
        logger.warn("app slash metric invalid cmd name", { slug, cmd });
      }
      return;
    }
    incCounter(`app.${slug}.slash.${cmd}.${ok ? "ok" : "err"}`);
  } catch (err) {
    try {
      logger.warn("app metric record failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // never let logger failure escape
    }
  }
}

export function recordAppTimeseries(slug: string, name: string, value: number): void {
  try {
    // Regex check FIRST (critic S2): an invalid name with a finite value
    // should still warn about the name, not be silently dropped at the
    // isFinite gate.
    if (!CUSTOM_NAME_REGEX.test(name)) {
      if (!tsWarnedOverCap.has(slug)) {
        tsWarnedOverCap.add(slug);
        logger.warn("app timeseries metric invalid name", { slug, name });
      }
      return;
    }
    if (!Number.isFinite(value)) return;
    let nameSet = tsNamesPerSlug.get(slug);
    if (!nameSet) {
      nameSet = new Set<string>();
      tsNamesPerSlug.set(slug, nameSet);
    }
    if (!nameSet.has(name)) {
      if (nameSet.size >= MAX_CUSTOM_METRICS_PER_SLUG) {
        if (!tsWarnedOverCap.has(slug)) {
          tsWarnedOverCap.add(slug);
          logger.warn("app timeseries metric cap exceeded", {
            slug,
            cap: MAX_CUSTOM_METRICS_PER_SLUG,
          });
        }
        return;
      }
      nameSet.add(name);
    }
    let slugMap = tsPerSlug.get(slug);
    if (!slugMap) {
      slugMap = new Map<string, Array<{ t: number; v: number }>>();
      tsPerSlug.set(slug, slugMap);
    }
    let ring = slugMap.get(name);
    if (!ring) {
      ring = [];
      slugMap.set(name, ring);
    }
    ring.push({ t: Date.now(), v: value });
    while (ring.length > TS_RING_SIZE) ring.shift();
  } catch (err) {
    try {
      logger.warn("app timeseries record failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // never let logger failure escape
    }
  }
}

export function getAppTimeseries(
  slug: string,
  name: string,
): Array<{ t: number; v: number }> {
  // Shallow copy so caller can't mutate the live ring.
  return [...(tsPerSlug.get(slug)?.get(name) ?? [])];
}

export function getAppTimeseriesNames(slug: string): string[] {
  // Iterate the storage Map keys (critic V3 — single source of truth). The
  // tsNamesPerSlug Set is the cap tracker and could drift from the storage
  // Map under future restore paths; never trust it for read-side iteration.
  return [...(tsPerSlug.get(slug)?.keys() ?? [])];
}

// Restore a single point directly into the ring (no cap enforcement on name
// registration — same bypass as counter restore from Influx, R13).
function restoreTimeseriesPoint(slug: string, name: string, t: number, v: number): void {
  let slugMap = tsPerSlug.get(slug);
  if (!slugMap) {
    slugMap = new Map();
    tsPerSlug.set(slug, slugMap);
  }
  let ring = slugMap.get(name);
  if (!ring) {
    ring = [];
    slugMap.set(name, ring);
  }
  ring.push({ t, v });
  while (ring.length > TS_RING_SIZE) ring.shift();
}

// Write new timeseries points (since last persist tick) to Influx.
// Each point carries its actual timestamp so the line chart shows real
// historical latency across server restarts.
// Measurement: tele_app_timeseries; tags: slug, metric; field: value (float).
export async function persistAppTimeseries(): Promise<void> {
  if (!isConfigured()) return;
  const since = tsPersistCursorMs;
  const points: Point[] = [];
  for (const [slug, slugMap] of tsPerSlug) {
    for (const [name, ring] of slugMap) {
      for (const p of ring) {
        if (p.t > since) {
          points.push(
            new Point("tele_app_timeseries")
              .tag("slug", slug)
              .tag("metric", name)
              .floatField("value", p.v)
              .timestamp(new Date(p.t)),
          );
        }
      }
    }
  }
  if (points.length === 0) return;
  writePoints(points);
  tsPersistCursorMs = Date.now();
}

// Restore the last 240 points per (slug, metric) from Influx on boot.
// Queries the 3h window (covers 240 × 30s ≈ 2hr ring with margin).
// After restore, advances tsPersistCursorMs so the next persist tick only
// writes newly emitted points, not the just-restored ones.
export async function loadAppTimeseriesFromInflux(): Promise<void> {
  if (!isConfigured()) return;
  const bucket = config.INFLUXDB_BUCKET;
  if (!bucket) return;
  const query = `from(bucket: "${bucket}")
    |> range(start: -3h)
    |> filter(fn: (r) => r._measurement == "tele_app_timeseries")
    |> sort(columns: ["_time"])`;
  for await (const row of queryFlux(query)) {
    const slug = row["slug"] as string | undefined;
    const name = row["metric"] as string | undefined;
    const value = row["_value"];
    const time = row["_time"];
    const numeric = typeof value === "number" ? value : Number(value);
    const ts = typeof time === "string" ? new Date(time).getTime() : Number(time);
    if (!slug || !name) continue;
    if (!CUSTOM_NAME_REGEX.test(name)) continue;
    if (!Number.isFinite(numeric) || !Number.isFinite(ts)) continue;
    restoreTimeseriesPoint(slug, name, ts, numeric);
  }
  tsPersistCursorMs = Date.now();
}

export interface AppEmitContext {
  emit: (name: string, value?: number) => void;
  emitTimeseries: (name: string, value: number) => void;
}

export function makeAppEmit(slug: string): AppEmitContext {
  return {
    emit: (name: string, value: number = 1): void => {
      try {
        if (!CUSTOM_NAME_REGEX.test(name)) {
          if (!warnedOverCap.has(slug)) {
            warnedOverCap.add(slug);
            logger.warn("app custom metric invalid name", { slug, name });
          }
          return;
        }
        let set = customNamesPerSlug.get(slug);
        if (!set) {
          set = new Set<string>();
          customNamesPerSlug.set(slug, set);
        }
        if (!set.has(name)) {
          if (set.size >= MAX_CUSTOM_METRICS_PER_SLUG) {
            if (!warnedOverCap.has(slug)) {
              warnedOverCap.add(slug);
              logger.warn("app custom metric cap exceeded", {
                slug,
                cap: MAX_CUSTOM_METRICS_PER_SLUG,
              });
            }
            return;
          }
          set.add(name);
        }
        incCounter(`app.${slug}.custom.${name}`, value);
      } catch (err) {
        try {
          logger.warn("app custom metric emit failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        } catch {
          // never let logger failure escape
        }
      }
    },
    emitTimeseries: (name: string, value: number): void => {
      recordAppTimeseries(slug, name, value);
    },
  };
}
