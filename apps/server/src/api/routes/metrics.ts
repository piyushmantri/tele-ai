import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AppMetricsDetail,
  ApplicationMetricSummary,
  Application,
  MetricsResponse,
  MetricsTimeseriesResponse,
} from "@tele/shared";
import { sql } from "../../db/index.js";
import {
  getCounters,
  getGauges,
  getHistograms,
  getRecentErrors,
  getStartTime,
  incCounter,
} from "../../util/metrics.js";
import {
  isConfigured as influxConfigured,
  queryFlux,
  getLastWriteAt,
} from "../../util/influx.js";
import { config } from "../../config.js";
import { isConnected } from "../../telegram/client.js";
import { isBotConnected } from "../../telegram/botClient.js";
import { getActiveServers } from "../../mcp/manager.js";
import { getActiveJobCount } from "../../scheduler/index.js";
import { getTelegramBotConfig } from "../../db/repos/telegramBotConfig.js";
import { listMCPServers } from "../../db/repos/mcp.js";
import {
  listApplications,
  getApplicationBySlug,
} from "../../db/repos/applications.js";
import {
  getAppTimeseries,
  getAppTimeseriesNames,
} from "../../ai/applicationMetrics.js";
import { logger } from "../../util/logger.js";
import { getPricingMeta, loadPricingFromDb, refreshPricing } from "../../ai/pricing.js";
import { setOverride } from "../../db/repos/modelPricing.js";

const TABLES = [
  "chats",
  "messages",
  "contact_rules",
  "reminders",
  "tool_audit_log",
  "mcp_servers",
  "kanban_tasks",
  "kanban_comments",
  "sent_polls",
  "skills",
  "slash_commands",
  "telegram_bot_config",
  "pending_choices",
];

const METRIC_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,128}$/;

async function pingDb(): Promise<number | null> {
  const t = Date.now();
  try {
    await sql`SELECT 1`;
    return Date.now() - t;
  } catch {
    return null;
  }
}

function buildHourlyBuckets(
  rows: Array<{ hour: string; direction: string; n: number }>,
): Array<{ hour: string; in: number; out: number }> {
  // Build a 24-hour ascending bucket window from now-23h..now (rounded to hour),
  // zero-filling missing rows.
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const buckets: Array<{ hour: string; in: number; out: number }> = [];
  const map = new Map<string, { in: number; out: number }>();
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now.getTime() - i * 3600_000);
    const key = h.toISOString();
    map.set(key, { in: 0, out: 0 });
  }
  for (const r of rows) {
    const k = new Date(r.hour).toISOString();
    const slot = map.get(k);
    if (!slot) continue;
    if (r.direction === "in") slot.in = Number(r.n);
    else if (r.direction === "out") slot.out = Number(r.n);
  }
  for (const [hour, v] of map) buckets.push({ hour, in: v.in, out: v.out });
  return buckets;
}

function buildAppMetricSummary(
  app: Application,
  counters: Record<string, number>,
  histograms: Record<string, ReturnType<typeof getHistograms>[string]>,
): ApplicationMetricSummary {
  const slug = app.slug;
  const slashPrefix = `app.${slug}.slash.`;
  const customPrefix = `app.${slug}.custom.`;
  const callOkKey = `app.${slug}.call.ok`;
  const callErrKey = `app.${slug}.call.err`;
  const durationKey = `app.${slug}.duration_ms`;

  const calls_ok = counters[callOkKey] ?? 0;
  const calls_err = counters[callErrKey] ?? 0;

  const byCmd = new Map<string, { ok: number; err: number }>();
  const custom_counters: Record<string, number> = {};
  for (const [key, n] of Object.entries(counters)) {
    if (key.startsWith(slashPrefix)) {
      const tail = key.slice(slashPrefix.length).split(".");
      if (tail.length !== 2) continue;
      const [cmd, status] = tail;
      if (!cmd || !status) continue;
      const slot = byCmd.get(cmd) ?? { ok: 0, err: 0 };
      if (status === "ok") slot.ok = n;
      else if (status === "err") slot.err = n;
      byCmd.set(cmd, slot);
      continue;
    }
    if (key.startsWith(customPrefix)) {
      const name = key.slice(customPrefix.length);
      if (!name) continue;
      custom_counters[name] = n;
      continue;
    }
  }
  // Bare `app.<slug>.<event>` keys (e.g. `app.<slug>.ai_context_loaded` for
  // ai_only apps — see applications.ts) live at depth 3 and don't match the
  // slash/custom prefixes above. Surface them on `custom_counters` so the
  // per-app page renders at least one tile for ai_only apps.
  const baseDepth3Prefix = `app.${slug}.`;
  for (const [key, n] of Object.entries(counters)) {
    if (!key.startsWith(baseDepth3Prefix)) continue;
    const tail = key.slice(baseDepth3Prefix.length);
    if (tail.length === 0) continue;
    // Skip already-classified prefixes/keys.
    if (tail.startsWith("slash.")) continue;
    if (tail.startsWith("custom.")) continue;
    if (tail === "call.ok" || tail === "call.err") continue;
    if (tail === "duration_ms") continue;
    // Plain leaf event — e.g. `ai_context_loaded`. Hoist as a counter.
    if (tail.includes(".")) continue;
    if (custom_counters[tail] === undefined) custom_counters[tail] = n;
  }
  const slash_dispatched_by_cmd = [...byCmd.entries()].map(([cmd, v]) => ({
    cmd,
    ok: v.ok,
    err: v.err,
  }));
  const slash_dispatched_total = slash_dispatched_by_cmd.reduce(
    (s, x) => s + x.ok + x.err,
    0,
  );

  return {
    id: app.id,
    slug,
    name: app.name,
    type: app.type,
    enabled: app.enabled,
    calls_ok,
    calls_err,
    slash_dispatched_total,
    slash_dispatched_by_cmd,
    duration: histograms[durationKey] ?? null,
    custom_counters,
  };
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/metrics", async (_req, reply) => {
    try {
      const dbPingPromise = pingDb();

      const [
        chatsByType,
        chatsBlockedRow,
        chatsActiveRow,
        messagesTotalRow,
        messagesByDirection,
        messagesBySource24h,
        messagesHourlyRows,
        pendingChoicesAgg,
        toolAuditTotalRow,
        toolAudit24hRow,
        topToolsRows,
        remindersAgg,
        kanbanByStatus,
        kanbanCommentsRow,
        mcpAgg,
        skillsAgg,
        slashAgg,
        rulesByType,
        pollsRow,
        tableRowsRows,
        lastMigrationRows,
        botCfg,
        mcpRows,
        appRows,
      ] = await Promise.all([
        sql`SELECT chat_type, COUNT(*)::int AS n FROM chats GROUP BY chat_type`,
        sql`SELECT COUNT(*)::int AS n FROM chats WHERE is_blocked = TRUE`,
        sql`SELECT COUNT(*)::int AS n FROM chats WHERE last_message_at >= now() - interval '24 hours'`,
        sql`SELECT COUNT(*)::int AS n FROM messages`,
        sql`SELECT direction,
                   COUNT(*) FILTER (WHERE created_at >= now() - interval '1 hour')::int  AS h1,
                   COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS h24,
                   COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days')::int   AS h7d
              FROM messages GROUP BY direction`,
        sql`SELECT source, COUNT(*)::int AS n FROM messages WHERE created_at >= now() - interval '24 hours' GROUP BY source`,
        sql`SELECT date_trunc('hour', created_at) AS hour, direction, COUNT(*)::int AS n
              FROM messages
             WHERE created_at >= now() - interval '24 hours'
             GROUP BY hour, direction
             ORDER BY hour`,
        sql`SELECT COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at > now())::int  AS outstanding,
                   COUNT(*) FILTER (WHERE consumed_at IS NOT NULL)::int                       AS consumed,
                   COUNT(*) FILTER (WHERE consumed_at IS NULL AND expires_at <= now())::int   AS expired,
                   COUNT(*)::int                                                              AS total
              FROM pending_choices`,
        sql`SELECT COUNT(*)::int AS total FROM tool_audit_log`,
        sql`SELECT COUNT(*)::int AS day_total FROM tool_audit_log WHERE created_at >= now() - interval '24 hours'`,
        sql`SELECT tool_name,
                   COUNT(*) FILTER (WHERE ok = TRUE)::int  AS ok_n,
                   COUNT(*) FILTER (WHERE ok = FALSE)::int AS err_n
              FROM tool_audit_log
             WHERE created_at >= now() - interval '24 hours'
             GROUP BY tool_name
             ORDER BY COUNT(*) DESC
             LIMIT 10`,
        sql`SELECT COUNT(*) FILTER (WHERE active = TRUE)::int AS active,
                   COUNT(*) FILTER (WHERE fired = TRUE)::int  AS fired,
                   COUNT(*)::int                              AS total
              FROM reminders`,
        sql`SELECT status, COUNT(*)::int AS n FROM kanban_tasks GROUP BY status`,
        sql`SELECT COUNT(*)::int AS n FROM kanban_comments`,
        sql`SELECT COUNT(*) FILTER (WHERE enabled = TRUE)::int AS enabled, COUNT(*)::int AS total FROM mcp_servers`,
        sql`SELECT COUNT(*) FILTER (WHERE enabled = TRUE)::int AS enabled, COUNT(*)::int AS total FROM skills`,
        sql`SELECT COUNT(*) FILTER (WHERE enabled = TRUE)::int AS enabled, COUNT(*)::int AS total FROM slash_commands`,
        sql`SELECT type, COUNT(*)::int AS n FROM contact_rules GROUP BY type`,
        sql`SELECT COUNT(*)::int AS n FROM sent_polls`,
        sql(
          TABLES.map((t) => `SELECT '${t}' AS t, COUNT(*)::int AS n FROM ${t}`).join(" UNION ALL "),
          [],
        ),
        sql`SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`,
        getTelegramBotConfig(),
        listMCPServers(),
        listApplications(),
      ]);

      const db_ping_ms = await dbPingPromise;

      const chats_by_type: Record<"private" | "group" | "channel" | "bot", number> = {
        private: 0,
        group: 0,
        channel: 0,
        bot: 0,
      };
      for (const row of chatsByType as Array<{ chat_type: string; n: number }>) {
        if (row.chat_type in chats_by_type) {
          chats_by_type[row.chat_type as "private" | "group" | "channel" | "bot"] = Number(row.n);
        }
      }
      const chats_total =
        chats_by_type.private + chats_by_type.group + chats_by_type.channel + chats_by_type.bot;

      let messages_in_1h = 0,
        messages_in_24h = 0,
        messages_in_7d = 0,
        messages_out_1h = 0,
        messages_out_24h = 0,
        messages_out_7d = 0;
      for (const row of messagesByDirection as Array<{
        direction: string;
        h1: number;
        h24: number;
        h7d: number;
      }>) {
        if (row.direction === "in") {
          messages_in_1h = Number(row.h1);
          messages_in_24h = Number(row.h24);
          messages_in_7d = Number(row.h7d);
        } else if (row.direction === "out") {
          messages_out_1h = Number(row.h1);
          messages_out_24h = Number(row.h24);
          messages_out_7d = Number(row.h7d);
        }
      }

      const messages_by_source_24h: Record<"user" | "ai" | "manual", number> = {
        user: 0,
        ai: 0,
        manual: 0,
      };
      for (const row of messagesBySource24h as Array<{ source: string; n: number }>) {
        if (row.source in messages_by_source_24h) {
          messages_by_source_24h[row.source as "user" | "ai" | "manual"] = Number(row.n);
        }
      }

      const messages_hourly_24h = buildHourlyBuckets(
        messagesHourlyRows as Array<{ hour: string; direction: string; n: number }>,
      );

      const pcAgg = (pendingChoicesAgg as Array<{
        outstanding: number;
        consumed: number;
        expired: number;
        total: number;
      }>)[0] ?? { outstanding: 0, consumed: 0, expired: 0, total: 0 };

      const toolTotal = Number(
        (toolAuditTotalRow as Array<{ total: number }>)[0]?.total ?? 0,
      );
      const tool24h = Number(
        (toolAudit24hRow as Array<{ day_total: number }>)[0]?.day_total ?? 0,
      );
      const topTools = (topToolsRows as Array<{ tool_name: string; ok_n: number; err_n: number }>).map(
        (r) => ({ tool_name: r.tool_name, ok: Number(r.ok_n), err: Number(r.err_n) }),
      );

      const remAgg = (remindersAgg as Array<{ active: number; fired: number; total: number }>)[0] ?? {
        active: 0,
        fired: 0,
        total: 0,
      };

      const kanban: MetricsResponse["kanban"] = { todo: 0, in_progress: 0, done: 0, total: 0, comments_total: 0 };
      for (const r of kanbanByStatus as Array<{ status: string; n: number }>) {
        if (r.status === "todo") kanban.todo = Number(r.n);
        else if (r.status === "in_progress") kanban.in_progress = Number(r.n);
        else if (r.status === "done") kanban.done = Number(r.n);
      }
      kanban.total = kanban.todo + kanban.in_progress + kanban.done;
      kanban.comments_total = Number(
        (kanbanCommentsRow as Array<{ n: number }>)[0]?.n ?? 0,
      );

      const mcpDbAgg = (mcpAgg as Array<{ enabled: number; total: number }>)[0] ?? { enabled: 0, total: 0 };
      const skillsDbAgg = (skillsAgg as Array<{ enabled: number; total: number }>)[0] ?? { enabled: 0, total: 0 };
      const slashDbAgg = (slashAgg as Array<{ enabled: number; total: number }>)[0] ?? { enabled: 0, total: 0 };
      const rules: MetricsResponse["rules"] = { allow: 0, block: 0 };
      for (const r of rulesByType as Array<{ type: string; n: number }>) {
        if (r.type === "allow") rules.allow = Number(r.n);
        else if (r.type === "block") rules.block = Number(r.n);
      }

      const polls = { total: Number((pollsRow as Array<{ n: number }>)[0]?.n ?? 0) };

      const table_rows: Record<string, number> = {};
      for (const r of tableRowsRows as Array<{ t: string; n: number }>) {
        table_rows[r.t] = Number(r.n);
      }

      const lastMigRow = (lastMigrationRows as Array<{ filename: string; applied_at: string }>)[0];
      const last_migration = lastMigRow
        ? { filename: lastMigRow.filename, applied_at: new Date(lastMigRow.applied_at).toISOString() }
        : null;

      const activeMcp = getActiveServers();
      const connectedNames = new Set(activeMcp.map((s) => s.name));
      const mcpServers = (mcpRows as Array<{ name: string; enabled: boolean }>).map((s) => ({
        name: s.name,
        enabled: Boolean(s.enabled),
        connected: connectedNames.has(s.name),
      }));

      // Cost-counter delta over the last 24h. Two Flux queries (first / last)
      // because the existing metrics.ts style uses single-pipeline queries.
      let cost_micro_usd_24h: number | null = null;
      if (influxConfigured()) {
        try {
          const bucket = config.INFLUXDB_BUCKET;
          const fluxBase = `from(bucket: "${bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "tele_counter" and r.name == "gemini.cost_micro_usd" and r._field == "value")`;
          let firstVal: number | null = null;
          let lastVal: number | null = null;
          for await (const row of queryFlux(fluxBase + " |> first()")) {
            const v = Number(row["_value"]);
            if (Number.isFinite(v)) firstVal = v;
          }
          for await (const row of queryFlux(fluxBase + " |> last()")) {
            const v = Number(row["_value"]);
            if (Number.isFinite(v)) lastVal = v;
          }
          if (firstVal !== null && lastVal !== null) {
            cost_micro_usd_24h = Math.max(0, lastVal - firstVal);
          }
        } catch (err) {
          logger.warn("cost_24h flux query failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const counters = getCounters();
      // Hoist histograms snapshot — used both for the applications slice
      // (derived per-app duration) and as the top-level histograms field in
      // the response. One sync capture before any further branching.
      const histograms = getHistograms();

      // Build per-application metric summaries from the in-memory counter
      // and histogram maps. ai_only apps appear with all-zero / null fields
      // since they have no hook to instrument (V5 acceptance criterion).
      // ai_only apps surface `ai_context_loaded` as a depth-3 custom counter
      // (R12 mitigation, see buildAppMetricSummary).
      const applications: ApplicationMetricSummary[] = [];
      for (const appRow of appRows) {
        applications.push(buildAppMetricSummary(appRow, counters, histograms));
      }

      const response: MetricsResponse = {
        generated_at: new Date().toISOString(),
        server: {
          uptime_s: Math.round((Date.now() - getStartTime()) / 1000),
          ready: true,
          telegram_connected: isConnected(),
          bot_connected: isBotConnected(),
          db_ping_ms,
          last_migration,
          snapshot_at: getLastWriteAt(),
        },
        counters,
        gauges: getGauges(),
        histograms,
        errors_recent: getRecentErrors(20),
        telegram: {
          chats_total,
          chats_by_type,
          chats_blocked: Number((chatsBlockedRow as Array<{ n: number }>)[0]?.n ?? 0),
          chats_active_24h: Number((chatsActiveRow as Array<{ n: number }>)[0]?.n ?? 0),
          messages_total: Number((messagesTotalRow as Array<{ n: number }>)[0]?.n ?? 0),
          messages_in_1h,
          messages_in_24h,
          messages_in_7d,
          messages_out_1h,
          messages_out_24h,
          messages_out_7d,
          messages_by_source_24h,
          messages_hourly_24h,
        },
        bot: {
          configured: !!botCfg,
          enabled: Boolean(botCfg?.enabled),
          pending_choices_outstanding: Number(pcAgg.outstanding ?? 0),
          pending_choices_consumed: Number(pcAgg.consumed ?? 0),
          pending_choices_expired: Number(pcAgg.expired ?? 0),
          pending_choices_total: Number(pcAgg.total ?? 0),
        },
        ai: {
          tool_calls_total: toolTotal,
          tool_calls_24h: tool24h,
          tool_calls_24h_by_tool: topTools,
          cost_micro_usd_total: counters["gemini.cost_micro_usd"] ?? 0,
          cost_micro_usd_24h,
          pricing: getPricingMeta(),
        },
        mcp: {
          total: Number(mcpDbAgg.total ?? 0),
          enabled: Number(mcpDbAgg.enabled ?? 0),
          connected: activeMcp.length,
          servers: mcpServers,
        },
        scheduler: {
          reminders_total: Number(remAgg.total ?? 0),
          reminders_active: Number(remAgg.active ?? 0),
          reminders_fired: Number(remAgg.fired ?? 0),
          jobs_scheduled_in_memory: getActiveJobCount(),
        },
        slash: { total: Number(slashDbAgg.total ?? 0), enabled: Number(slashDbAgg.enabled ?? 0) },
        skills: { total: Number(skillsDbAgg.total ?? 0), enabled: Number(skillsDbAgg.enabled ?? 0) },
        kanban,
        polls,
        rules,
        db: { table_rows },
        applications,
      };

      return response;
    } catch (err) {
      incCounter("metrics.endpoint.err");
      const msg = err instanceof Error ? err.message : String(err);
      // Transient Neon fetch failures are common during cold starts. Downgrade to
      // warn — client polls every 5s and recovers on next tick. Hard errors
      // (schema/code bugs) still surface via stack trace at warn level.
      logger.warn("metrics endpoint failed", { err: msg });
      reply.code(503).send({ error: "metrics endpoint failed", retry: true });
      return;
    }
  });

  app.get("/api/metrics/timeseries", async (req, reply) => {
    const q = z
      .object({
        metric: z.string().min(1),
        hours: z.coerce.number().int().min(1).max(720).default(24),
      })
      .parse(req.query);
    if (!METRIC_NAME_REGEX.test(q.metric)) {
      reply.code(400).send({ error: "invalid metric name" });
      return;
    }
    if (!influxConfigured()) {
      reply.code(503).send({ error: "influx not configured" });
      return;
    }
    const bucket = config.INFLUXDB_BUCKET;
    const flux = `from(bucket: "${bucket}")
      |> range(start: -${q.hours}h)
      |> filter(fn: (r) =>
           (r._measurement == "tele_counter" or r._measurement == "tele_gauge" or r._measurement == "tele_histogram")
           and r.name == "${q.metric}"
           and (r._field == "value" or r._field == "p95"))
      |> keep(columns: ["_time", "_value"])
      |> sort(columns: ["_time"])`;

    const points: Array<{ t: string; value: number }> = [];
    try {
      for await (const row of queryFlux(flux)) {
        const time = row["_time"] as string | undefined;
        const value = row["_value"];
        const numeric = typeof value === "number" ? value : Number(value);
        if (time && Number.isFinite(numeric)) {
          points.push({ t: time, value: numeric });
        }
      }
    } catch (err) {
      logger.error("timeseries query failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      reply.code(502).send({ error: "timeseries query failed" });
      return;
    }
    const response: MetricsTimeseriesResponse = { metric: q.metric, points };
    return response;
  });

  // Per-application detail endpoint. Returns the same ApplicationMetricSummary
  // shape as the bulk /api/metrics endpoint (built via buildAppMetricSummary)
  // plus the in-memory timeseries ring for this slug. Timestamps are numeric
  // Unix ms (`Date.now()` output) — half the payload size of ISO strings and
  // no client parse cost.
  const APP_SLUG_REGEX = /^[a-z0-9-]{1,64}$/;
  app.get("/api/metrics/app/:slug", async (req, reply) => {
    const params = z
      .object({ slug: z.string().regex(APP_SLUG_REGEX) })
      .safeParse(req.params);
    if (!params.success) {
      reply.code(400).send({ error: "invalid slug" });
      return;
    }
    const slug = params.data.slug;
    const appRow = await getApplicationBySlug(slug);
    if (!appRow) {
      reply.code(404).send({ error: "application not found" });
      return;
    }
    const counters = getCounters();
    const histograms = getHistograms();
    const application = buildAppMetricSummary(appRow, counters, histograms);
    const timeseries: AppMetricsDetail["timeseries"] = [];
    // Iterate via getAppTimeseriesNames — single source of truth for which
    // ts names have been registered for this slug.
    for (const name of getAppTimeseriesNames(slug)) {
      const ring = getAppTimeseries(slug, name);
      // Emit numeric ms timestamps as-is (critic V5) — t stays a number.
      timeseries.push({
        name,
        points: ring.map((p) => ({ t: p.t, v: p.v })),
      });
    }
    const body: AppMetricsDetail = { application, timeseries };
    return body;
  });

  app.get("/api/metrics/pricing", async () => {
    return {
      ...getPricingMeta(),
      hint: "PUT { override_input_per_1m_usd, override_output_per_1m_usd } to pin manually; both null to clear.",
    };
  });

  const PricingPutSchema = z
    .object({
      model_id: z.string().min(1).optional(),
      override_input_per_1m_usd: z.number().positive().nullable(),
      override_output_per_1m_usd: z.number().positive().nullable(),
    })
    .refine(
      (b) =>
        (b.override_input_per_1m_usd === null) ===
        (b.override_output_per_1m_usd === null),
      { message: "must set both or neither" },
    );

  app.put("/api/metrics/pricing", async (req, reply) => {
    const parsed = PricingPutSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "invalid body" });
      return;
    }
    const modelId = parsed.data.model_id ?? config.GEMINI_MODEL;
    try {
      await setOverride(
        modelId,
        parsed.data.override_input_per_1m_usd,
        parsed.data.override_output_per_1m_usd,
      );
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        reply.code(409).send({ error: "conflict" });
        return;
      }
      throw err;
    }
    await loadPricingFromDb();
    return getPricingMeta();
  });

  app.post("/api/metrics/pricing/refresh", async () => {
    await refreshPricing();
    return getPricingMeta();
  });
}
