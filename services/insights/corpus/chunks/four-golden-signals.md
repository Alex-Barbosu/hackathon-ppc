---
id: four-golden-signals
source: [sre-book-monitoring]
title: The four golden signals and how to page
topics: [observability, sre, latency, errors, saturation, traffic, alerting]
answers: [observability, peak-vs-normal]
---
From Google's *Site Reliability Engineering*, chapter "Monitoring Distributed Systems"
(Ewaschuk, 2016; CC BY-NC-ND 4.0, paraphrased).

If you can measure only four things about a user-facing system, measure:
- **Latency**: time to serve a request. Track successful and failed requests separately;
  "a slow error is even worse than a fast error".
- **Traffic**: demand, in a system-specific unit (requests/s, readings/s, bytes/s).
- **Errors**: explicit (5xx), implicit (200 with wrong content, e.g. a corrupted file) and
  by policy (slower than the promised limit counts as failed).
- **Saturation**: how full the most constrained resource is. Systems degrade before 100%
  utilisation, so set a utilisation target.

**Means hide the tail**: a 100 ms average can hide requests taking seconds. Record latency as
a histogram (bucketed counts) and read percentiles; a short-window p99 is an early saturation
signal.

**Symptoms over causes**: alert on what users feel ("outage files not available"), watch
causes ("FTP CPU high") on dashboards.

**Paging rules**: every page must be actionable, need human judgement, be about something
new, and be urgent. Anything else belongs on a dashboard or a ticket.

**How the analyst uses this**
- Map FileGrid metrics: latency = `filegrid_op_duration_seconds`, traffic = `filegrid_ops_total`
  and `filegrid_bytes_total`, errors = outcome=error plus `filegrid_integrity_failures_total`,
  saturation = `filegrid_queue_depth` and `filegrid_spool_pending`.
- When explaining an alert, lead with the symptom and the business guarantee at risk, then the
  probable cause.
