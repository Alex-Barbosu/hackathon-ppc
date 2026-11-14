---
id: reliability-indices-definitions
source: [lbnl-eto-2018]
title: SAIDI, SAIFI, CAIDI and MAIFI, what each one measures
topics: [reliability, saidi, saifi, caidi, maifi, ieee-1366]
answers: [outage-hotspots]
---
Distribution utilities measure reliability as "the annual average amount of time and
frequency that the lights are out" (Eto, LBNL, 2018). The four standard indices:

- **SAIDI** (System Average Interruption Duration Index): total customer-minutes of
  sustained interruptions divided by customers served. Unit: minutes per customer per year.
- **SAIFI** (System Average Interruption Frequency Index): number of customer interruptions
  divided by customers served. Unit: interruptions per customer per year.
- **CAIDI** = SAIDI / SAIFI: the average restoration time of an interruption, for the
  customers who were actually interrupted.
- **MAIFI**: frequency of momentary interruptions (auto-reclosers, brief blinks).

The sustained/momentary threshold differs by region: IEEE 1366 (US) uses 5 minutes; in
Europe (EN 50160 and most regulators, including Romania's ANRE) a "long" interruption is
over 3 minutes. Always say which convention a number uses before comparing countries.

**How the analyst uses this**
- SAIFI high, CAIDI normal: the network fails often but crews restore quickly. Points to
  asset condition, vegetation, overhead lines. Fix: maintenance, reclosers, undergrounding.
- SAIFI normal, CAIDI high: failures are rare but slow to restore. Points to access, crew
  availability, missing remote switching. Fix: distribution automation, crew positioning.
- Compute these from FileGrid outage records per county: customer-minutes =
  customers affected × duration. If customers affected is missing, say the index is a proxy
  (count and duration of events) and not a true SAIDI.
