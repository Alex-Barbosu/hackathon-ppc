# Grid analyst knowledge corpus

Expert material the Claude grid analyst uses to ground its interpretations for brief
section 5: which storage fits each category, how a peak day compares with a normal day,
and what the data says about the grid (meter anomalies, outage hotspots).

The analyst's numbers always come from Prometheus and the database views. This corpus only
supplies the **yardsticks and method**: what a "bad" SAIDI is in Romania, how utilities
separate storm days from normal days, how to read a latency tail, why one storage fits a
category better than another.

## Layout

| Path | What |
| --- | --- |
| `SOURCES.md` | Every external source: title, author, date, URL, licence note. |
| `chunks/*.md` | Retrieval units, one idea each, 150–450 words, with YAML front matter. |
| `talks.yaml` | Expert talks (YouTube) to transcribe locally; see "Transcripts" below. |
| `tools/fetch_transcripts.py` | Pulls those transcripts into `.transcripts/` (gitignored). |

## Chunk format

```markdown
---
id: romania-saidi-trend            # unique, kebab-case, equals the file name
source: [capital-2026, fi-2020]    # keys from SOURCES.md; `filegrid-synthesis` = our own reasoning
title: Romania national SAIDI, 2019-2025
topics: [reliability, saidi, romania]
answers: [outage-hotspots]         # storage-fit | peak-vs-normal | meter-anomalies | outage-hotspots | observability
---
Body: paraphrased facts with numbers, then "How the analyst uses this".
```

Chunks with `source: filegrid-synthesis` are the team's interpretation built on the cited
sources. The analyst must present them as method, never as an external fact.

## Licence policy

- We store **paraphrased notes and facts** with short attributed quotes, never full copies
  of copyrighted text. Facts (numbers, definitions) are not copyrightable; prose is.
- US federal works (EIA) are public domain. The Google SRE books are CC BY-NC-ND 4.0, so we
  paraphrase and attribute and never redistribute their text.
- YouTube transcripts belong to their creators. They are fetched locally for private
  retrieval only and are **never committed** (`.transcripts/` is gitignored).

## Transcripts

The cloud sandbox that built this corpus cannot reach YouTube, so transcripts are pulled on
a developer machine:

```bash
pip install youtube-transcript-api pyyaml
python3 services/insights/corpus/tools/fetch_transcripts.py
```

Output lands in `services/insights/corpus/.transcripts/<id>.md`, chunked by about 400 words
with the same front matter, so the loader indexes them next to `chunks/` when present.

## Privacy

Nothing here contains personal data. Retrieval results go into Claude prompts, so never add
customer documents, names or ID numbers to this folder (root rule 8).
