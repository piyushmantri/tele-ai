import { useQuery } from "@tanstack/react-query";
import { Card, CardBody } from "kodeui";
import type { AppMetricsDetail, HistogramSnapshot, KundaliMatchRow } from "@tele/shared";
import { api, ApiError } from "../lib/api";
import { qk } from "../lib/queryKeys";
import LineChart from "./charts/LineChart";
import HBar from "./charts/HBar";

// Inline copies of small KPI/HistogramRow primitives (R9 trade-off — avoids
// touching the existing Metrics.tsx visual layout for v1).

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "ok" | "bad" | "muted";
}) {
  const valColor =
    tone === "bad"
      ? "var(--kode-error)"
      : tone === "ok"
      ? "var(--kode-success)"
      : "var(--kode-text-primary)";
  return (
    <div
      className="min-w-[140px] flex-1 rounded p-3"
      style={{ background: "var(--kode-bg-darker)" }}
    >
      <div
        className="text-xs uppercase tracking-wide"
        style={{ color: "var(--kode-text-muted)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 text-xl font-semibold tabular-nums"
        style={{ color: valColor }}
      >
        {value}
      </div>
    </div>
  );
}

function HistogramRow({
  name,
  snap,
}: {
  name: string;
  snap: HistogramSnapshot;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-1 text-sm">
      <span
        className="w-48 truncate"
        style={{ color: "var(--kode-text-secondary)" }}
        title={name}
      >
        {name}
      </span>
      <span
        className="w-16 tabular-nums"
        style={{ color: "var(--kode-text-muted)" }}
      >
        n={snap.count}
      </span>
      <span
        className="w-24 tabular-nums"
        style={{ color: "var(--kode-text-muted)" }}
      >
        p50 {snap.p50.toFixed(0)}
      </span>
      <span
        className="w-24 tabular-nums"
        style={{ color: "var(--kode-warning)" }}
      >
        p95 {snap.p95.toFixed(0)}
      </span>
      <span
        className="w-24 tabular-nums"
        style={{ color: "var(--kode-error)" }}
      >
        p99 {snap.p99.toFixed(0)}
      </span>
      <span
        className="w-24 tabular-nums"
        style={{ color: "var(--kode-text-primary)" }}
      >
        max {snap.max.toFixed(0)}
      </span>
    </div>
  );
}

function SubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3
        className="mb-2 text-xs font-semibold uppercase tracking-wide"
        style={{ color: "var(--kode-text-muted)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

interface Props {
  slug: string;
}

export default function ApplicationObservabilityTab({ slug }: Props) {
  const q = useQuery({
    queryKey: qk.appMetrics(slug),
    queryFn: () =>
      api.get<AppMetricsDetail>(
        `/api/metrics/app/${encodeURIComponent(slug)}`,
      ),
    refetchInterval: 5000,
    refetchOnWindowFocus: false,
  });

  if (q.isLoading) {
    return (
      <div
        className="p-4 text-sm"
        style={{ color: "var(--kode-text-muted)" }}
      >
        Loading…
      </div>
    );
  }

  if (q.error) {
    const status =
      q.error instanceof ApiError ? q.error.status : null;
    if (status === 404) {
      return (
        <div
          className="p-4 text-sm"
          style={{ color: "var(--kode-text-muted)" }}
        >
          Application has no metrics yet.
        </div>
      );
    }
    return (
      <div
        className="p-4 text-sm"
        style={{ color: "var(--kode-error)" }}
      >
        Failed to load metrics:{" "}
        {q.error instanceof Error ? q.error.message : String(q.error)}
      </div>
    );
  }

  if (!q.data) return null;
  const { application, timeseries } = q.data;
  const counterCount = Object.keys(application.custom_counters).length;
  const tsCount = timeseries.length;

  const topSlash = [...application.slash_dispatched_by_cmd]
    .sort((a, b) => b.ok + b.err - (a.ok + a.err))
    .slice(0, 5)
    .map((s) => ({
      label: s.cmd,
      value: s.ok + s.err,
      segments: [
        { value: s.ok, color: "#10b981" },
        { value: s.err, color: "#f43f5e" },
      ],
    }));

  return (
    <div className="space-y-4">
      <div
        className="text-xs"
        style={{ color: "var(--kode-text-muted)" }}
      >
        Timeseries persisted to InfluxDB; charts survive restarts. Last 240 samples per metric shown.
      </div>

      <SubSection title="Summary">
        <div className="flex flex-wrap gap-3">
          <KpiTile label="Calls ok" value={application.calls_ok} tone="ok" />
          <KpiTile
            label="Calls err"
            value={application.calls_err}
            tone={application.calls_err > 0 ? "bad" : undefined}
          />
          <KpiTile
            label="Slash total"
            value={application.slash_dispatched_total}
          />
          <KpiTile label="Counters" value={counterCount} />
          <KpiTile label="Timeseries" value={tsCount} />
        </div>
      </SubSection>

      <SubSection title="Time series">
        {timeseries.length === 0 ? (
          <div
            className="text-xs italic"
            style={{ color: "var(--kode-text-muted)" }}
          >
            No timeseries emitted yet.
          </div>
        ) : (
          <div className="space-y-3">
            {timeseries.map((ts) => {
              const lastV =
                ts.points.length > 0
                  ? ts.points[ts.points.length - 1]!.v
                  : null;
              return (
                <Card key={ts.name}>
                  <CardBody>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <span
                        className="font-mono text-sm"
                        style={{ color: "var(--kode-text-primary)" }}
                      >
                        {ts.name}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: "var(--kode-text-muted)" }}
                      >
                        last {lastV ?? "—"} · last 240 samples
                      </span>
                    </div>
                    <LineChart points={ts.points} />
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </SubSection>

      <SubSection title="Counters">
        {counterCount === 0 ? (
          <div
            className="text-xs italic"
            style={{ color: "var(--kode-text-muted)" }}
          >
            No custom counters emitted yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {Object.entries(application.custom_counters)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, n]) => (
                <KpiTile key={name} label={name} value={n} />
              ))}
          </div>
        )}
      </SubSection>

      {topSlash.length > 0 && (
        <SubSection title="Slash commands">
          <HBar items={topSlash} />
        </SubSection>
      )}

      {application.duration && (
        <SubSection title="getContext duration">
          <HistogramRow
            name={`app.${application.slug}.duration_ms`}
            snap={application.duration}
          />
        </SubSection>
      )}

      <MatchHistorySection applicationId={application.id} />
    </div>
  );
}

function MatchHistorySection({ applicationId }: { applicationId: string }) {
  const q = useQuery({
    queryKey: qk.applicationMatches(applicationId),
    queryFn: () =>
      api.get<{ matches: KundaliMatchRow[] }>(
        `/api/applications/${applicationId}/matches`,
      ),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });

  const matches = q.data?.matches ?? [];
  if (!q.isLoading && matches.length === 0) return null;

  return (
    <SubSection title="Match history">
      {q.isLoading ? (
        <div className="text-xs italic" style={{ color: "var(--kode-text-muted)" }}>
          Loading…
        </div>
      ) : (
        <div className="space-y-1">
          {matches.map((m) => {
            const d = m.data;
            const score = typeof d.score === "number" ? (d.score * 100).toFixed(0) : "—";
            const total = d.ashtakoot_total != null ? String(d.ashtakoot_total) : "?";
            const max = d.ashtakoot_max != null ? String(d.ashtakoot_max) : "?";
            const name = typeof d.candidate_name === "string" ? d.candidate_name : "Unknown";
            const dob = typeof d.candidate_dob === "string" ? d.candidate_dob : "";
            const gender = typeof d.candidate_gender === "string" ? d.candidate_gender : "";
            const summary = typeof d.summary === "string" ? d.summary : "";
            const when = new Date(m.created_at).toLocaleString();
            return (
              <div
                key={m.id}
                className="rounded p-3 text-sm"
                style={{ background: "var(--kode-bg-darker)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className="font-semibold"
                    style={{ color: "var(--kode-text-primary)" }}
                  >
                    {name}
                  </span>
                  <span
                    className="tabular-nums text-xs"
                    style={{ color: "var(--kode-text-muted)" }}
                  >
                    {when}
                  </span>
                </div>
                <div
                  className="mt-1 text-xs"
                  style={{ color: "var(--kode-text-secondary)" }}
                >
                  {dob} · {gender} · Score {total}/{max} ({score}%)
                </div>
                {summary && (
                  <div className="mt-1 text-xs" style={{ color: "var(--kode-text-muted)" }}>
                    {summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SubSection>
  );
}
