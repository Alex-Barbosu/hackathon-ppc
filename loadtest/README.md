# Load tests (zone B)

k6 scenarios go here: `baseline.js`, `storm-outage.js`, `video-lossy.js`.
Run them with the `grafana/k6` image on the `filegrid_app` network so they hit the gateway
like a real client. Results go to Prometheus via remote write (already enabled).
