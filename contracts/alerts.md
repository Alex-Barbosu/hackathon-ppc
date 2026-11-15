# Alerts contract (v0)

Rules live in `infra/prometheus/rules/` (zone B). Alertmanager posts every alert to
`http://insights:8070/insights/alerts` (zone C narrator), payload = Alertmanager webhook v4
(see `AlertmanagerWebhook` in `openapi.yaml`).

Every rule carries labels `severity` (`warning`|`critical`), `category` (or `all`),
`guarantee` (the business guarantee at risk), and annotations `summary` + `description`.

| Alert | Guarantee at risk (brief §2.1) | Sketch of expression | Severity |
| --- | --- | --- | --- |
| `MeterReadingLossRisk` | Meter readings never lost | `increase(meter_sim_sent_total[2m]) - increase(meter_sim_acked_total[2m]) > 50` or `filegrid_spool_pending{category="meter"} > 0` for 2m | critical |
| `MeterIngestLatencyHigh` | Meter readings not degraded by other categories | p95 of `filegrid_op_duration_seconds{category="meter"}` > 0.5 s for 2m | warning |
| `OutageAvailabilityDegraded` | Outage records available to dispatch immediately | p95 write for `outage` > 2 s, or error rate > 1 % for 2m | critical |
| `DocumentProtectionFailure` | Personal data protected and auditable | any write of `document` with `encrypted=false`, or audit-chain verification failure | critical |
| `VideoTransferStalling` | Video transfers survive unstable links | no progress on an active tus upload for 5m, or resume failures | warning |
| `StorageDown` | All (isolation) | `filegrid_storage_up == 0` for 30s | critical |
| `IntegrityFailure` | Retrieved file identical to stored | `increase(filegrid_integrity_failures_total[5m]) > 0` | critical |

Example webhook body:

```json
{
  "version": "4",
  "status": "firing",
  "receiver": "insights",
  "groupKey": "{}:{alertname=\"StorageDown\"}",
  "commonLabels": { "alertname": "StorageDown", "severity": "critical", "storage": "s3", "guarantee": "isolation" },
  "commonAnnotations": { "summary": "S3 storage is down" },
  "alerts": [
    {
      "status": "firing",
      "labels": { "alertname": "StorageDown", "storage": "s3" },
      "annotations": { "summary": "S3 storage is down", "description": "filegrid_storage_up{storage=\"s3\"} == 0 for 30s" },
      "startsAt": "2026-11-14T12:41:00Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "fingerprint": "a1b2c3"
    }
  ]
}
```

## Paging (insights)

Every alert still goes to the narrator. Insights pages an on-call person only for alerts that put a
"never lose data" guarantee at risk, and only once they have fired for `PAGER_HOLD_SEC` (default 60 s),
so a flap never wakes anyone:

| Route | Trigger | Who | Topic |
| --- | --- | --- | --- |
| `platform` | `StorageDown`, `IntegrityFailure`, `MeterReadingLossRisk`, `DocumentProtectionFailure`, or any alert labelled `page: "true"` | admin on-call | `<NTFY_TOPIC>-admin` |
| `grid` | ≥ `PAGER_GRID_THRESHOLD` (5) outage records in one county within 15 min (insights reads `public.files`, no Prometheus rule) | that region's dispatch on-call | `<NTFY_TOPIC>-dispatch-<region>` |

Delivery is ntfy (`NTFY_URL`, default `https://ntfy.sh`). The push carries the alert summary, the
narrator's two sentences, a link, and an Acknowledge button that posts a one-time token to
`<NTFY_TOPIC>-ack`; insights listens there, so the phone never needs to reach the gateway.
Without `NTFY_TOPIC` the pager still records pages in the UI (`GET /insights/pages`).
