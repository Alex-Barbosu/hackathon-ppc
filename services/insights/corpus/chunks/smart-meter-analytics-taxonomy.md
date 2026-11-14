---
id: smart-meter-analytics-taxonomy
source: [wang-2018-sma]
title: What utilities do with smart meter data
topics: [smart-meter, ami, load-profiling, forecasting, demand-response]
answers: [meter-anomalies, peak-vs-normal]
---
Wang, Chen, Hong and Kang (IEEE Transactions on Smart Grid, 2018) group smart meter analytics
into three families:

- **Load analysis**: bad data detection, energy theft (non-technical loss) detection, and
  load profiling (clustering customers by the shape of their daily curve).
- **Load forecasting**: point and probabilistic forecasts, at customer and aggregate level.
- **Load management**: customer characterisation, demand response targeting, tariff design
  and baseline estimation.
- Plus: connection (phase/transformer) verification, outage detection from "last gasp"
  messages and missing reads, data compression and privacy.

**Resolution.** Most meters record every 15 minutes to one hour. The review notes that data
at 30 minutes or finer is reliable enough for most profiling; finer data mainly helps
detection and real-time uses.

**Profiling methods.** Direct clustering of daily curves (k-means, hierarchical, SOM), or
reduce features first (PCA, autoencoders, symbolic aggregation) and then cluster.

**Open challenges they list.** Scarce labelled data (few confirmed theft cases), streaming
data needing online methods, multivariate fusion with weather, load transfers between
circuits that are poorly recorded, rooftop solar changing load shapes, and privacy: fine
interval data reveals household behaviour.

**How the analyst uses this**
- Meter readings in FileGrid are 15-minute interval files; that resolution supports anomaly
  detection and daily profiles, which is what the brief's section 5 needs.
- Missing reads clustered in one area at the same time are an **outage signal**, not a meter
  fault. Cross-check meter gaps against outage records before calling anything a meter anomaly.
- Never expose per-household curves in an answer; report aggregates per region or anonymised
  meter IDs (privacy, root rule 8).
