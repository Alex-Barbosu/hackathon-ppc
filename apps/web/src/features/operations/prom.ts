// Every PromQL string the Operations screen uses lives here, so a metric rename
// (contracts/metrics.md) is a one-file change.
export const WINDOW = "10m";
export const WINDOW_LABEL = "last 10 minutes";

export const Q = {
  p95: "histogram_quantile(0.95, sum by (le, category) (rate(filegrid_op_duration_seconds_bucket[1m])))",
  throughput: "sum by (category) (rate(filegrid_ops_total[1m]))",
  errorRate:
    'sum by (category) (rate(filegrid_ops_total{outcome="error"}[1m])) / clamp_min(sum by (category) (rate(filegrid_ops_total[1m])), 1e-9)',
  queueDepth: "sum by (category) (filegrid_queue_depth)",
  meterP95: 'histogram_quantile(0.95, sum by (le) (rate(filegrid_op_duration_seconds_bucket{category="meter"}[1m])))',
  outageQueue: 'sum(filegrid_queue_depth{category="outage"})',
  // Outage write rate is the fallback story line while zone A has not emitted queue depth.
  outageRate: 'sum(rate(filegrid_ops_total{category="outage"}[1m]))',
  // Windowed on purpose: lifetime totals restart from zero with each service, so after any restart they
  // disagree for reasons that are not lost readings. increase() corrects for counter resets.
  // Every reading ends with exactly one ack (accepted, or duplicate after a lost response), so all
  // acks together are the readings the simulator saw delivered; the API's accepted count is what it stored.
  simAcked: `sum(increase(meter_sim_acked_total[${WINDOW}]))`,
  storedAccepted: `sum(increase(filegrid_meter_readings_total{result="accepted"}[${WINDOW}]))`,
  storedDuplicates: `sum(increase(filegrid_meter_readings_total{result="duplicate"}[${WINDOW}]))`,
} as const;

export const PROM_BASE = "/grafana/api/datasources/proxy/uid/prometheus/api/v1";
