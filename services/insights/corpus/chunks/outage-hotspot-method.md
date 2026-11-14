---
id: outage-hotspot-method
source: [filegrid-synthesis, lbnl-eto-2018, re-dobrogea-2024, fi-2020]
title: Method for outage hotspots in Muntenia, Banat and Dobrogea
topics: [outage, hotspots, method, county, storms]
answers: [outage-hotspots]
---
Team method, built on the reliability chunks. Present as approach, not as external fact.

1. **Unit of analysis**: county (or substation when outage files carry it), per day.
2. **Measures**: event count, total duration, customer-minutes when customers affected is
   known. Derive SAIFI-like and SAIDI-like rates per 10,000 customers when a customer count
   per county is available; otherwise label results "event-based proxy".
3. **Clean first**: split planned from unplanned; flag Major Event Days (2.5-beta method or,
   with short history, days above 3× the median) and report with and without them.
4. **Rank** counties on unplanned, non-MED duration per customer. Show the top 3 with
   numbers, then whether they are frequency problems (high count) or restoration problems
   (long average duration, i.e. high CAIDI).
5. **Recurrence**: the same substation or feeder appearing in several weeks matters more than
   one big event. Call out repeats.
6. **Confidence**: state the number of events behind each claim. Under about 10 events in a
   county, say the ranking is not stable.

Answer shape for a decision maker (illustrative, not data): "Banat has 2.1× the unplanned outage minutes per customer
of Muntenia this week, mostly from 3 repeat faults at one substation; restoration time is
normal, so this is an asset problem, not a crew problem. Recommend inspection of X."
