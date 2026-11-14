// Exactly the meter_sim_* metrics of contracts/metrics.md, nothing renamed or added.
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { REGIONS } from "./geo.js";

export interface SimMetrics {
  registry: Registry;
  sent: Counter<"region">;
  acked: Counter<"region" | "result">;
  retries: Counter<"region">;
  rate: Gauge;
}

export function createMetrics(withDefaults = true): SimMetrics {
  const registry = new Registry();
  if (withDefaults) collectDefaultMetrics({ register: registry });
  const sent = new Counter({ name: "meter_sim_sent_total", help: "Unique readings generated (retries not counted)", labelNames: ["region"], registers: [registry] });
  const acked = new Counter({ name: "meter_sim_acked_total", help: "Acks received", labelNames: ["region", "result"], registers: [registry] });
  const retries = new Counter({ name: "meter_sim_retries_total", help: "Retries (same Idempotency-Key)", labelNames: ["region"], registers: [registry] });
  const rate = new Gauge({ name: "meter_sim_rate", help: "Configured readings per second", registers: [registry] });
  // Start every series at 0 so rate() and sent-minus-acked work from the first scrape.
  for (const region of REGIONS) {
    sent.inc({ region }, 0);
    retries.inc({ region }, 0);
    acked.inc({ region, result: "accepted" }, 0);
    acked.inc({ region, result: "duplicate" }, 0);
  }
  return { registry, sent, acked, retries, rate };
}
