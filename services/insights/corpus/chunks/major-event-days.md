---
id: major-event-days
source: [lbnl-eto-2018, eia-2025-outages]
title: Separating storm days from normal days (IEEE 1366 2.5-beta method)
topics: [reliability, major-event-day, storms, ieee-1366, peak-day]
answers: [outage-hotspots, peak-vs-normal]
---
Utilities do not compare a storm day with a normal day on raw totals. IEEE 1366 defines a
**Major Event Day (MED)** with the "2.5 beta" method (adopted 1998, amended 2003 and 2012):

1. Take daily SAIDI for the last five years (ignore zero days).
2. Take the natural log of each value; compute mean α and standard deviation β.
3. Threshold **T_MED = exp(α + 2.5·β)**. Any day with SAIDI above T_MED is a Major Event Day.

If daily SAIDI were exactly log-normal this gives about 2.3 MEDs per year; real utility data
varies (Eto's example utility had T_MED = 3.4 minutes and four MEDs in 2016).

Utilities report SAIDI both **with and without** major events. US investor-owned utilities
reported 237 minutes with and 136 minutes without major events in 2015 (LBNL). In 2024 the US
average customer was without power about 11 hours, of which nearly 9 hours came from major
events (hurricanes Beryl, Helene, Milton), about 80% of the total; non-major-event outage time
stays around 2 hours a year (EIA, Dec 2025). Year-to-year swings are driven by major events.

**How the analyst uses this**
- When asked "how did the storm compare with a normal day", first classify days: compute a
  daily outage-minutes series, apply the 2.5-beta threshold if there is enough history,
  otherwise say the baseline is short and use a ratio to the median day.
- Report two numbers: impact including the storm, and the underlying "blue-sky" level.
  A rising blue-sky level is a network problem; a storm spike is a resilience problem.
- Same logic applies to FileGrid itself: a ×10 outage-upload storm is FileGrid's "major
  event"; its p95 and error rate should be shown separately from the normal-day baseline.
