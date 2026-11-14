---
id: slo-burn-rate-alerting
source: [sre-workbook-alerting, talk-google-sli]
title: SLOs, error budgets and multiwindow burn-rate alerts
topics: [slo, sli, error-budget, burn-rate, alerting, sre]
answers: [observability]
---
From *The Site Reliability Workbook*, chapter "Alerting on SLOs" (Google, 2018; CC BY-NC-ND
4.0, paraphrased). Vargo and Fong-Jones's talk "SLIs, SLOs, SLAs, oh my!" covers the same
vocabulary: an **SLI** is the measured ratio of good events, an **SLO** the target for it, an
**SLA** the contract with consequences; the **error budget** is 1 − SLO.

**Burn rate** = how fast the error budget is being spent relative to the SLO. A burn rate of 1
spends exactly the whole budget by the end of the SLO window (e.g. 30 days).

The workbook compares six alerting approaches and recommends **multiwindow, multi-burn-rate**
alerts. For a 99.9% SLO:

| Severity | Long window | Short window | Burn rate | Budget consumed |
| --- | --- | --- | --- | --- |
| Page | 1 h | 5 min | 14.4 | 2% |
| Page | 6 h | 30 min | 6 | 5% |
| Ticket | 3 days | 6 h | 1 | 10% |

The alert fires only if both windows exceed the rate. The long window gives precision (no
paging on a blip); the short window makes the alert reset soon after the problem stops.

Simpler options and their flaws: alerting on raw error rate ≥ SLO pages on trivial blips;
long windows reset slowly; "for: 10m" durations delay detection regardless of severity.

**How the analyst uses this**
- Express each business guarantee as an SLI, e.g. meter: accepted readings / sent readings;
  outage: share of outage uploads stored within 2 s.
- When narrating an alert, say how much error budget the incident burned, not only the error
  rate: "this 6-minute FTP outage used 4% of the monthly document-availability budget".
- In a 24 h demo the windows must be scaled down; say so if asked why thresholds differ.
