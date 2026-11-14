---
id: latency-measurement-pitfalls
source: [tene-hs-2015, talk-tene-2015]
title: How not to measure latency (coordinated omission, percentiles, max)
topics: [latency, percentiles, load-testing, coordinated-omission, hdrhistogram, benchmark]
answers: [storage-fit, peak-vs-normal, observability]
---
From Gil Tene's talk "How NOT to Measure Latency" (Strange Loop 2015) and High Scalability's
write-up of it.

- **Latency is a distribution**, never a single number. The most common value is among the
  least useful things to report.
- **Coordinated omission**: many load generators wait for a response before sending the next
  request. When the system stalls they stop sending, so the slow period is barely sampled.
  In Tene's example a 200-second run with a 100-second freeze reports a ~10.9 ms average; the
  honest average is about 25 seconds. Tools often measure service time when users feel
  response time (including queueing).
- **Percentiles do not average**: an "average of p95 over two hours" is meaningless. Compute
  percentiles from merged histograms over the whole window.
- **Users hit the tail more than intuition says**: a page that makes 40 requests almost
  certainly includes one at or above the p95. Watch p99 and above.
- **Never drop the max**: it is the most honest single signal; plotting max over time at equal
  load shows which system is noisier.
- **Tool**: HdrHistogram keeps full precision across the range, so tails survive aggregation.

**How the analyst uses this**
- Storage Lab results must come from a fixed-rate (open-model) load, e.g. k6
  `constant-arrival-rate`, or the tail of a slow storage is under-reported. If the run used a
  closed loop, say the p99 is optimistic.
- In Prometheus, use `histogram_quantile` over `sum by (le)` of rates for the full window;
  never average per-instance quantiles.
- Quote p50, p95, p99 and max together when comparing storages.
