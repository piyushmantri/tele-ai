# tele observability — InfluxDB Cloud dashboard

Importable dashboard for InfluxDB Cloud v2 that mirrors the panels in
`apps/web/src/pages/Metrics.tsx`, sourced from the persisted measurements
`tele_counter`, `tele_gauge`, `tele_histogram`, and `tele_error` (bucket
`tele`, org `5837fa9faf00169f` by default).

## Prerequisites

- An InfluxDB Cloud v2 workspace with a bucket named `tele` (rename via
  the included `bucket` constant variable if yours differs — edit it after
  import under **Settings → Variables → bucket**).
- For CLI import: the `influx` CLI configured against your org. See
  https://docs.influxdata.com/influxdb/cloud/tools/influx-cli/.
- Wait 1–2 minutes after the first server boot before importing — the
  server flushes to Influx every 60s, so a fresh install will show empty
  panels until the first persistence cycle completes.

## Import via CLI

```sh
influx apply \
  -f infra/influx/tele-dashboard.json \
  --org-id 5837fa9faf00169f \
  --force yes
```

The `apply` command is idempotent — re-running it updates the existing
dashboard, label, and variable in place (matched by `metadata.name`).

## Import via UI

1. Open your InfluxDB Cloud workspace.
2. **Settings → Templates → Import Template**.
3. Paste the contents of `tele-dashboard.json` or upload the file.
4. Click **Apply**.
5. Open **Dashboards** and locate **tele observability** (filter by the
   `tele` label).

## What's included

13 cells across a 12-column grid: Telegram message rate, bot traffic,
Gemini call rate / latency / spend / token usage, top tools, error rate,
Telegram keepalive + watchdog, InfluxDB write health, WebSocket
subscribers, and responder activity. Panel intent and Flux query notes
live in `tasks/todo.md` (section A4).

## Caveats

- **Outbound message rate proxy**: there is no `router.outbound_sent`
  counter. The "Telegram message rate" cell uses `sender.message.ok` as
  the outbound proxy.
- **Cumulative AI spend resets on boot**: the cumulative-USD line is the
  raw `gemini.cost_micro_usd` counter; server restarts drop it to 0.
- **System health tiles omitted**: connected/ready booleans are not
  emitted as gauges yet. Add `setGauge` calls in `apps/server/src/` and
  extend the dashboard to surface them.
