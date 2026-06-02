import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import { getCounters, getGauges, getHistograms } from "./metrics.js";

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// Dynamic gauges populated on each scrape via callbacks
new Gauge({
  name: "tele_counter",
  help: "Monotonic event counters",
  labelNames: ["name"],
  registers: [registry],
  collect() {
    for (const [name, value] of Object.entries(getCounters())) {
      this.set({ name }, value);
    }
  },
});

new Gauge({
  name: "tele_gauge",
  help: "Instantaneous gauges",
  labelNames: ["name"],
  registers: [registry],
  collect() {
    for (const [name, value] of Object.entries(getGauges())) {
      this.set({ name }, value);
    }
  },
});

const histFields = ["count", "p50", "p95", "p99", "max", "mean"] as const;

for (const field of histFields) {
  const f = field;
  new Gauge({
    name: `tele_histogram_${f}`,
    help: `Histogram ${f}`,
    labelNames: ["name"],
    registers: [registry],
    collect() {
      for (const [name, snap] of Object.entries(getHistograms())) {
        this.set({ name }, snap[f]);
      }
    },
  });
}
