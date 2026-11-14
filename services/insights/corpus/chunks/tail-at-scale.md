---
id: tail-at-scale
source: [dean-barroso-2013]
title: The tail at scale, why rare slow responses dominate fan-out systems
topics: [latency, tail, fan-out, hedged-requests, distributed-systems]
answers: [storage-fit, observability]
---
Dean and Barroso, "The Tail at Scale" (Communications of the ACM, 2013). Paraphrased.

- **Variability is normal**: shared resources, background daemons, garbage collection,
  queueing, power limits and maintenance all cause occasional slow responses even on healthy
  machines.
- **Fan-out amplifies it**: if one server is slow (> 1 s) for 1 in 100 requests, a request
  that must wait for 100 such servers is slow 63% of the time (1 − 0.99¹⁰⁰).
- **Tail-tolerant techniques**: hedged requests (send a second copy after the first has waited
  longer than the p95; in their BigTable example this cut p99.9 from 1,800 ms to 74 ms for 2%
  extra requests), tied requests, micro-partitioning, selective replication of hot items,
  probation of slow machines, and good-enough results.
- The goal is predictably fast service built from less predictable parts, as fault tolerance
  builds reliable service from unreliable parts.

**How the analyst uses this**
- A FileGrid request touches one storage, so fan-out is small; but a video is uploaded in many
  16 MB parts and its completion time is set by the slowest part. Tail latency of S3 part
  writes matters more for video than the median.
- Recommend retries with backoff and idempotent writes (already required for meters) before
  hedging; hedging doubles load on an already struggling storage.
