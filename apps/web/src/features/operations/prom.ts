// Every PromQL string the Operations screen uses lives here, so a metric rename
// (contracts/metrics.md) is a one-file change.
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
  simSent: "sum(meter_sim_sent_total)",
  simAcked: 'sum(meter_sim_acked_total{result="accepted"})',
  simDuplicates: 'sum(meter_sim_acked_total{result="duplicate"})',
  storedAccepted: 'sum(filegrid_meter_readings_total{result="accepted"})',
  storedDuplicates: 'sum(filegrid_meter_readings_total{result="duplicate"})',
} as const;

export const PROM_BASE = "/grafana/api/datasources/proxy/uid/prometheus/api/v1";
