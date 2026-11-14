---
id: meter-anomaly-detection
source: [wang-2018-sma, filegrid-synthesis]
title: Detecting stuck meters, theft-like drops and bad readings
topics: [smart-meter, anomaly, theft, non-technical-loss, stuck-meter, data-quality]
answers: [meter-anomalies]
---
From the Wang et al. review (2018), with the team's mapping to FileGrid underneath.

**Bad data.** Missing values, outliers and stuck (constant) readings. Time-series methods
(weighted averaging, autoregression with outlier tests) and sliding-window clustering work
on streams. Low-rank matrix methods use correlation between neighbouring meters and handle
random errors well but **struggle with stuck readings**, so stuck meters need their own rule.

**Theft / non-technical loss.** Supervised classifiers need labelled theft cases, which are
rare and imbalanced. Unsupervised approaches flag customers whose consumption is far below an
expected or forecast value, or whose profile is an outlier in its cluster. A sustained drop
below forecast is the classic theft signal, but **outages, vacancy and occupancy changes look
the same**, so it needs confirmation. Longer history improves accuracy but delays detection.
Most published methods were tested on private data, so reported accuracies are not
comparable.

**FileGrid rules (team method)**
- Baseline per meter = same 15-minute slot over previous days (same weekday when history
  allows). Flag |z| > 3.
- **Stuck meter**: identical cumulative register or zero delta for ≥ 8 consecutive intervals
  while neighbours vary.
- **Theft-like drop**: daily energy < 40% of the meter's 7-day median for ≥ 2 days, with no
  outage recorded for its area.
- **Voltage sag**: voltage < 0.9 pu (207 V on 230 V nominal, the EN 50160 lower band) in
  several meters of one area at once points to the network, not the meters.
- Explain the top 3 with numbers and the alternative explanation, and say "candidate", never
  "theft": confirming theft is a field inspection.
