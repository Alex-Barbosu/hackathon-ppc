---
id: peak-vs-normal-method
source: [filegrid-synthesis, sre-book-monitoring, lbnl-eto-2018]
title: Comparing a peak day with a normal day, for FileGrid and for the grid
topics: [peak-day, storm, comparison, method, observability]
answers: [peak-vs-normal]
---
Team method. A decision maker wants three things: how much more load, did service hold, and
what to change.

**1. Load**: per category, readings or files per minute and bytes per minute, peak day vs a
matching normal day (same weekday, same hours). Report the ratio and the peak 5-minute rate,
not only daily totals: a ×10 storm for 20 minutes disappears in a daily average.

**2. Service** (the four golden signals per category × storage):
- Latency: p50, p95, p99 and max, from histograms over the same window (never averaged
  percentiles).
- Errors and fallbacks: error rate and the share of writes that went to the fallback storage.
- Saturation: queue depth and spool pending per category. Rising queue depth with flat
  latency means the bulkhead is absorbing the spike; rising queue depth with rising latency
  means it is about to fail.
- Isolation proof: the categories that were **not** stormed should show unchanged p95
  (within noise) during the storm. That is the NFR "a 10x spike in one category does not
  degrade others".

**3. Business guarantees**: meters sent = stored, 0 duplicates; outage files available within
target; any alert fired and how long it lasted.

**Answer shape** (illustrative numbers, not measurements): "During the 20-minute outage storm (×9.6 uploads), outage p95 rose from
180 ms to 410 ms with 0 errors; meter p95 stayed at 22 ms (normal 21 ms) and no reading was
lost. Queue depth peaked at 310 of 500. Recommendation: raise outage workers from 8 to 12
before the next storm season; confidence high (4,800 samples)."
