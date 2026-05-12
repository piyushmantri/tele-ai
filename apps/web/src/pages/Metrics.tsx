import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ErrorBucket,
  HistogramSnapshot,
  MetricsResponse,
} from "@tele/shared";
import { api } from "../lib/api";
import { qk } from "../lib/queryKeys";
import Sparkline from "../components/charts/Sparkline";
import HBar from "../components/charts/HBar";
import HourlyMessagesChart from "../components/charts/HourlyMessagesChart";
import PercentileBar from "../components/charts/PercentileBar";

const RING_CAP = 60; // 5 min @ 5s polling

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function diffSeries(values: number[]): number[] {
  if (values.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    out.push(Math.max(0, values[i]! - values[i - 1]!));
  }
  return out;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  spark,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  spark?: number[];
  tone?: "ok" | "bad" | "muted";
}) {
  const valColor = tone === "bad" ? "text-rose-400" : tone === "ok" ? "text-emerald-400" : "text-slate-100";
  return (
    <div className="min-w-[140px] flex-1 rounded bg-slate-800 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valColor}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      {spark && spark.length > 0 && (
        <div className="mt-1">
          <Sparkline values={spark} width={120} height={20} />
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  value,
  spark,
}: {
  label: string;
  value: React.ReactNode;
  spark?: number[];
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <span className="truncate text-slate-300" title={label}>{label}</span>
      <div className="flex items-center gap-3">
        {spark && spark.length > 0 && <Sparkline values={spark} width={80} height={18} />}
        <span className="w-16 text-right tabular-nums text-slate-100">{value}</span>
      </div>
    </div>
  );
}

function HistogramRow({ name, snap }: { name: string; snap: HistogramSnapshot }) {
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <span className="w-48 truncate text-slate-300" title={name}>{name}</span>
      <span className="w-16 tabular-nums text-slate-400">n={snap.count}</span>
      <span className="w-24 tabular-nums text-slate-400">p50 {snap.p50.toFixed(0)}</span>
      <span className="w-24 tabular-nums text-amber-400">p95 {snap.p95.toFixed(0)}</span>
      <span className="w-24 tabular-nums text-rose-400">p99 {snap.p99.toFixed(0)}</span>
      <span className="w-24 tabular-nums text-slate-100">max {snap.max.toFixed(0)}</span>
      <PercentileBar snap={snap} />
    </div>
  );
}

function ErrorRow({ bucket }: { bucket: ErrorBucket }) {
  const color = bucket.level === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-3 py-1 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="w-16 uppercase tracking-wide text-slate-500">{bucket.level}</span>
      <span className="flex-1 truncate text-slate-300" title={bucket.message}>{bucket.source}</span>
      <span className="w-12 tabular-nums text-slate-400">{bucket.count}</span>
      <span className="w-20 text-right text-slate-500">{fmtAgo(bucket.last_seen)}</span>
    </div>
  );
}

export default function Metrics() {
  const samplesRef = useRef<MetricsResponse[]>([]);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.metrics,
    queryFn: () => api.get<MetricsResponse>("/api/metrics"),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });
  const refreshPricing = useMutation({
    mutationFn: () => api.post("/api/metrics/pricing/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.metrics }),
  });

  useEffect(() => {
    if (!q.data) return;
    samplesRef.current = [...samplesRef.current, q.data].slice(-RING_CAP);
  }, [q.data]);

  if (!q.data) return <div className="p-6 text-sm text-slate-400">Loading...</div>;

  const data = q.data;
  const samples = samplesRef.current;

  const counterSeries = (name: string): number[] =>
    samples.map((s) => s.counters[name] ?? 0);
  const counterRateSeries = (name: string): number[] => diffSeries(counterSeries(name));
  const histSeries = (name: string, field: keyof HistogramSnapshot): number[] =>
    samples.map((s) => Number(s.histograms[name]?.[field] ?? 0));
  const gaugeSeries = (name: string): number[] => samples.map((s) => s.gauges[name] ?? 0);

  const dbPingSeries = samples
    .map((s) => s.server.db_ping_ms)
    .filter((v): v is number => typeof v === "number");

  const errors_5m_count = data.errors_recent.filter(
    (e) => Date.now() - new Date(e.last_seen).getTime() < 5 * 60_000,
  ).length;

  const lastError = data.errors_recent[0];

  // Telegram tile colors
  const tgConn = data.server.telegram_connected;
  const botConn = data.server.bot_connected;

  // chats by type
  const chatTypeColors: Record<string, string> = {
    private: "#60a5fa",
    group: "#34d399",
    channel: "#a78bfa",
    bot: "#f59e0b",
  };
  const chatsByTypeItems = Object.entries(data.telegram.chats_by_type).map(([k, v]) => ({
    label: k,
    value: v,
    color: chatTypeColors[k],
  }));

  const messagesSourceItems = Object.entries(data.telegram.messages_by_source_24h).map(
    ([k, v]) => ({ label: k, value: v, color: k === "ai" ? "#a78bfa" : k === "user" ? "#60a5fa" : "#94a3b8" }),
  );

  // top tools — stacked ok/err
  const topToolItems = data.ai.tool_calls_24h_by_tool.map((t) => ({
    label: t.tool_name,
    value: t.ok + t.err,
    segments: [
      { value: t.ok, color: "#10b981" },
      { value: t.err, color: "#f43f5e" },
    ],
  }));

  // slash dispatched per type
  const slashTypes = ["message", "shell", "ai_prompt", "noop"];
  const slashItems = slashTypes.map((t) => ({
    label: `dispatched.${t}`,
    value: data.counters[`slash.dispatched.${t}`] ?? 0,
    color: "#60a5fa",
  }));

  // db.table_rows sorted desc
  const tableRowItems = Object.entries(data.db.table_rows)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => ({ label: t, value: n, color: "#475569" }));

  // gemini histogram
  const geminiHist = data.histograms["gemini.latency_ms"];

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-end justify-between">
        <h1 className="text-xl font-semibold">Observability</h1>
        <div className="text-xs text-slate-500">
          generated {fmtAgo(data.generated_at)} · persisted {fmtAgo(data.server.snapshot_at)}
        </div>
      </div>
      <div className="mb-4 text-xs text-slate-500">
        Counters/gauges/errors restore from latest InfluxDB snapshot on boot. Sparklines are
        rolling 5 min in-browser; reset on full page refresh. Histograms reset on server restart.
      </div>

      <div className="space-y-4">
        {/* 1. System health */}
        <Section title="System health">
          <div className="flex flex-wrap gap-3">
            <KpiTile label="Uptime" value={fmtUptime(data.server.uptime_s)} />
            <KpiTile
              label="Telegram"
              value={tgConn ? "connected" : "disconnected"}
              tone={tgConn ? "ok" : "bad"}
            />
            <KpiTile
              label="Bot"
              value={botConn ? "connected" : data.bot.configured ? "disconnected" : "—"}
              tone={botConn ? "ok" : data.bot.configured ? "bad" : "muted"}
            />
            <KpiTile
              label="DB ping"
              value={data.server.db_ping_ms != null ? `${data.server.db_ping_ms}ms` : "fail"}
              spark={dbPingSeries}
              tone={data.server.db_ping_ms == null ? "bad" : undefined}
            />
            <KpiTile label="Ready" value={data.server.ready ? "yes" : "no"} tone={data.server.ready ? "ok" : "bad"} />
          </div>
        </Section>

        {/* 2. Liveness */}
        <Section title="Liveness">
          <div className="flex flex-wrap gap-3">
            <KpiTile
              label="MCP connected"
              value={`${data.mcp.connected} / ${data.mcp.enabled}`}
              sub={`${data.mcp.total} configured`}
            />
            <KpiTile
              label="Last error"
              value={lastError ? lastError.source.slice(0, 40) : "—"}
              sub={lastError ? fmtAgo(lastError.last_seen) : "no errors"}
              tone={lastError ? "bad" : "ok"}
            />
            <KpiTile
              label="Errors 5m"
              value={errors_5m_count}
              tone={errors_5m_count > 0 ? "bad" : "ok"}
            />
            <KpiTile
              label="Last migration"
              value={data.server.last_migration?.filename ?? "—"}
              sub={data.server.last_migration ? fmtAgo(data.server.last_migration.applied_at) : ""}
            />
          </div>
        </Section>

        {/* 3. Telegram traffic */}
        <Section title="Telegram traffic">
          <div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <KpiTile label="In 1h" value={data.telegram.messages_in_1h} />
            <KpiTile label="In 24h" value={data.telegram.messages_in_24h} />
            <KpiTile label="In 7d" value={data.telegram.messages_in_7d} />
            <KpiTile label="Out 1h" value={data.telegram.messages_out_1h} />
            <KpiTile label="Out 24h" value={data.telegram.messages_out_24h} />
            <KpiTile label="Out 7d" value={data.telegram.messages_out_7d} />
          </div>
          <div className="mb-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-xs text-slate-500">Chats by type ({data.telegram.chats_total} total · {data.telegram.chats_blocked} blocked · {data.telegram.chats_active_24h} active 24h)</div>
              <HBar items={chatsByTypeItems} />
            </div>
            <div>
              <div className="mb-2 text-xs text-slate-500">Messages by source (24h)</div>
              <HBar items={messagesSourceItems} />
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs text-slate-500">Messages per hour (24h)</div>
            <HourlyMessagesChart data={data.telegram.messages_hourly_24h} />
          </div>
        </Section>

        {/* 4. Bot client */}
        <Section title="Bot client">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile label="Configured" value={data.bot.configured ? "yes" : "no"} tone={data.bot.configured ? undefined : "muted"} />
            <KpiTile label="Enabled" value={data.bot.enabled ? "yes" : "no"} tone={data.bot.enabled ? "ok" : "muted"} />
            <KpiTile label="Pending outstanding" value={data.bot.pending_choices_outstanding} />
            <KpiTile label="Consumed" value={data.bot.pending_choices_consumed} />
            <KpiTile label="Expired" value={data.bot.pending_choices_expired} />
          </div>
          <div className="space-y-1">
            <MetricRow label="bot.message_received" value={data.counters["bot.message_received"] ?? 0} spark={counterRateSeries("bot.message_received")} />
            <MetricRow label="bot.callback_received" value={data.counters["bot.callback_received"] ?? 0} spark={counterRateSeries("bot.callback_received")} />
            <MetricRow label="bot.callback_blocked" value={data.counters["bot.callback_blocked"] ?? 0} />
            <MetricRow label="bot.choice_claimed.ok" value={data.counters["bot.choice_claimed.ok"] ?? 0} />
            <MetricRow label="bot.choice_claimed.stale" value={data.counters["bot.choice_claimed.stale"] ?? 0} />
            <MetricRow label="tool.invoked.ask_user_choice.ok" value={data.counters["tool.invoked.ask_user_choice.ok"] ?? 0} />
            <MetricRow label="tool.invoked.ask_user_choice.err" value={data.counters["tool.invoked.ask_user_choice.err"] ?? 0} />
          </div>
        </Section>

        {/* 5. AI / Gemini */}
        <Section title="AI / Gemini">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile label="gemini.call.ok" value={data.counters["gemini.call.ok"] ?? 0} spark={counterRateSeries("gemini.call.ok")} />
            <KpiTile label="gemini.call.error" value={data.counters["gemini.call.error"] ?? 0} tone={(data.counters["gemini.call.error"] ?? 0) > 0 ? "bad" : undefined} />
            <KpiTile label="gemini.call.retry" value={data.counters["gemini.call.retry"] ?? 0} />
            <KpiTile label="responder.reply_sent" value={data.counters["responder.reply_sent"] ?? 0} />
            <KpiTile label="responder.empty_skipped" value={data.counters["responder.empty_reply_skipped"] ?? 0} />
            <KpiTile label="tokens.prompt" value={data.counters["gemini.tokens.prompt"] ?? 0} />
            <KpiTile label="tokens.completion" value={data.counters["gemini.tokens.completion"] ?? 0} />
          </div>
          <div className="mb-3 rounded bg-slate-800 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-300">AI Spend</div>
              <button
                onClick={() => refreshPricing.mutate()}
                disabled={refreshPricing.isPending}
                className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600 disabled:opacity-50"
                title="Fetch latest pricing from Gemini now"
              >
                {refreshPricing.isPending ? "Refreshing…" : "Refresh pricing"}
              </button>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-6">
              <div>
                <div className="text-xs text-slate-400">since boot</div>
                <div className="text-xl tabular-nums">
                  ${(data.ai.cost_micro_usd_total / 1_000_000).toFixed(4)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">last 24h</div>
                <div className="text-xl tabular-nums">
                  {data.ai.cost_micro_usd_24h === null
                    ? "—"
                    : `$${(data.ai.cost_micro_usd_24h / 1_000_000).toFixed(4)}`}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">cost rate</div>
                <Sparkline values={counterRateSeries("gemini.cost_micro_usd")} width={140} height={24} />
                <div className="text-xs text-slate-500">rolling 5 min, micro-USD/poll</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {data.ai.pricing.input_per_1m_usd === null ||
              data.ai.pricing.output_per_1m_usd === null ? (
                <span>Pricing not yet fetched — refresh runs every 24h</span>
              ) : (
                <>
                  ${data.ai.pricing.input_per_1m_usd}/1M in · ${data.ai.pricing.output_per_1m_usd}/1M out
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      data.ai.pricing.is_override
                        ? "bg-amber-900 text-amber-300"
                        : "bg-emerald-900 text-emerald-300"
                    }`}
                  >
                    {data.ai.pricing.is_override ? "override" : "auto"}
                  </span>
                  {data.ai.pricing.source_url && (
                    <a
                      className="ml-2 text-sky-400 underline"
                      href={data.ai.pricing.source_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source
                    </a>
                  )}
                  {data.ai.pricing.fetched_at && (
                    <span className="ml-2 text-slate-500">
                      fetched {fmtAgo(data.ai.pricing.fetched_at)}
                    </span>
                  )}
                  <span className="ml-2 text-slate-500">model: {data.ai.pricing.model_id}</span>
                </>
              )}
            </div>
          </div>
          <div className="mb-2 text-xs text-slate-500">Latency</div>
          {geminiHist ? (
            <>
              <HistogramRow name="gemini.latency_ms" snap={geminiHist} />
              <div className="mt-2">
                <MetricRow
                  label="p95 latency (rolling 5m)"
                  value={`${histSeries("gemini.latency_ms", "p95").slice(-1)[0] ?? 0}ms`}
                  spark={histSeries("gemini.latency_ms", "p95")}
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">No samples yet</div>
          )}
        </Section>

        {/* 6. Tool calls */}
        <Section title="Tool calls (24h)">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile label="Total all-time" value={data.ai.tool_calls_total} />
            <KpiTile label="24h" value={data.ai.tool_calls_24h} />
          </div>
          <div className="mb-2 text-xs text-slate-500">Top 10 tools (green=ok, rose=err)</div>
          <HBar items={topToolItems} />
          <div className="mt-3 space-y-1">
            {topToolItems.map((t) => {
              const snap = data.histograms[`tool.duration_ms.${t.label}`];
              if (!snap) return null;
              return <HistogramRow key={t.label} name={`tool.duration_ms.${t.label}`} snap={snap} />;
            })}
          </div>
        </Section>

        {/* 7. MCP */}
        <Section title="MCP servers">
          <div className="space-y-1 text-sm">
            {data.mcp.servers.map((s) => (
              <div key={s.name} className="flex items-center gap-3 py-1">
                <span className="flex-1 truncate text-slate-300">{s.name}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${s.enabled ? "bg-emerald-900 text-emerald-300" : "bg-slate-800 text-slate-500"}`}>
                  {s.enabled ? "enabled" : "disabled"}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${s.connected ? "bg-emerald-900 text-emerald-300" : "bg-rose-900 text-rose-300"}`}>
                  {s.connected ? "connected" : "down"}
                </span>
              </div>
            ))}
            {data.mcp.servers.length === 0 && <div className="text-xs text-slate-500">No MCP servers configured</div>}
          </div>
          <div className="mt-3 space-y-1">
            {Object.entries(data.counters)
              .filter(([k]) => k.startsWith("mcp.list_tools_failed."))
              .map(([k, v]) => (
                <MetricRow key={k} label={k} value={v} />
              ))}
          </div>
        </Section>

        {/* 8. Scheduler */}
        <Section title="Scheduler / Reminders">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile label="Total" value={data.scheduler.reminders_total} />
            <KpiTile label="Active" value={data.scheduler.reminders_active} />
            <KpiTile label="Fired" value={data.scheduler.reminders_fired} />
            <KpiTile label="In-memory jobs" value={data.scheduler.jobs_scheduled_in_memory} />
          </div>
          <MetricRow label="scheduler.fired.ok" value={data.counters["scheduler.fired.ok"] ?? 0} spark={counterRateSeries("scheduler.fired.ok")} />
          <MetricRow label="scheduler.fired.err" value={data.counters["scheduler.fired.err"] ?? 0} />
        </Section>

        {/* 9. Slash commands */}
        <Section title="Slash commands">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile label="Total" value={data.slash.total} />
            <KpiTile label="Enabled" value={data.slash.enabled} />
          </div>
          <HBar items={slashItems} />
          <div className="mt-3 space-y-1">
            <MetricRow label="slash.not_found" value={data.counters["slash.not_found"] ?? 0} />
            <MetricRow label="slash.disabled" value={data.counters["slash.disabled"] ?? 0} />
          </div>
        </Section>

        {/* 10. Database */}
        <Section title="Database">
          <HBar items={tableRowItems} />
          <div className="mt-3 text-xs text-slate-500">
            Last migration:{" "}
            {data.server.last_migration ? (
              <span>
                {data.server.last_migration.filename} ({fmtAgo(data.server.last_migration.applied_at)})
              </span>
            ) : (
              "none"
            )}
          </div>
          <div className="mt-2">
            <MetricRow label="db.transient_retry" value={data.counters["db.transient_retry"] ?? 0} />
          </div>
        </Section>

        {/* 11. WebSocket */}
        <Section title="WebSocket">
          <div className="mb-3 flex flex-wrap gap-3">
            <KpiTile
              label="Subscribers"
              value={data.gauges["ws.subscribers"] ?? 0}
              spark={gaugeSeries("ws.subscribers")}
            />
            <KpiTile label="Send errors" value={data.counters["ws.send_error"] ?? 0} />
          </div>
        </Section>

        {/* 12. Errors */}
        <Section title="Errors (top 20)">
          {data.errors_recent.length === 0 ? (
            <div className="text-xs text-slate-500">No errors recorded</div>
          ) : (
            <div className="space-y-1">
              {data.errors_recent.map((e, i) => (
                <ErrorRow key={`${e.level}:${e.source}:${i}`} bucket={e} />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
