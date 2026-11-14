# Load tests (zone B)

k6 scenarios that drive FileGrid like real users, through the gateway (TLS, routing,
login). Nothing to install: they run in the `grafana/k6` image, and the stack must be up
(`make up`).

```sh
make b-load S=baseline                    # a normal day, 3 min
make b-load S=storm-outage                # outage uploads x10 (5 MB each), 2 min
make b-load S=video-lossy                 # 128 MB video over a slow, lossy link
make b-load S=storm-outage MULTIPLIER=20 DURATION=5m
make b-load S=video-lossy VIDEO_MB=1100 LOSS_PCT=0 LATENCY_MS=0 JITTER_MS=0 BANDWIDTH_KBPS=0   # > 1 GB
```

| Scenario | What it does | Pass criteria (k6 thresholds) |
| --- | --- | --- |
| `baseline.js` | Outage uploads 0.2/s (1–10 MB), documents 0.5/s (0.1–2 MB), searches 1/s. Every upload's receipt SHA-256 is compared with the SHA-256 k6 computed locally; every file is downloaded and hashed again. | < 1 % failed requests, > 99 % checks, outage upload p95 < 2 s, document p95 < 3 s |
| `storm-outage.js` | Outage uploads at 0.2/s × `MULTIPLIER` (default 10), `OUTAGE_MB` (default 5) each, open arrival model; documents at their normal 0.5/s as the bystander. | Documents: < 1 % failures and p95 < 3 s during the storm; storm < 5 % failures. Meter p95 is watched on Grafana. |
| `video-lossy.js` | Logs in as `field`, creates a tus upload, then degrades the slow lane through `/chaos/network` (default 150 ms ± 50 ms, 20 % connection loss, 50 Mbit/s), uploads in 8 MB chunks over https://localhost:8443, and after each cut connection asks the server for its offset (`HEAD`) and continues. Heals the link at the end, even on failure. Downloads the video and compares SHA-256. | Upload completed and download byte-identical |

How it runs: the `k6` service shares the gateway's network namespace, so
`https://localhost` is Caddy itself; `k6-slowlane` shares Toxiproxy's, so
`https://localhost:8443` is the degradable slow lane. Both have the Compose profile `load`,
so `make up` never starts them.

Results: the k6 summary in the terminal, and the same numbers in Prometheus via remote
write (`k6_*` metrics, label `testid=<scenario>-<HHMMSS>`). Grafana → FileGrid Overview →
*Load tests (k6)* row, with the `k6 run` variable to pick a run.

Variables (pass as `make b-load S=… NAME=value`): `DURATION`, `MULTIPLIER`,
`OUTAGE_PER_SEC`, `OUTAGE_MB`, `DOCUMENT_PER_SEC`, `VIDEO_MB`, `CHUNK_MB`, `LOSS_PCT`,
`LATENCY_MS`, `JITTER_MS`, `BANDWIDTH_KBPS`.
