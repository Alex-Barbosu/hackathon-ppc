"""Fetch transcripts for talks.yaml into ../.transcripts as retrieval chunks.

Runs on a developer machine (YouTube is blocked in the build sandbox). Output is gitignored
because transcripts belong to their creators; we only use them for private retrieval.
Usage: pip install youtube-transcript-api pyyaml && python3 fetch_transcripts.py
"""
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml
from youtube_transcript_api import YouTubeTranscriptApi

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".transcripts"
WORDS_PER_CHUNK = 400  # matches the hand-written chunks so ranking treats them alike


def video_id(url: str) -> str:
    return parse_qs(urlparse(url).query)["v"][0]


def main() -> None:
    talks = yaml.safe_load((ROOT / "talks.yaml").read_text())["talks"]
    OUT.mkdir(exist_ok=True)
    api = YouTubeTranscriptApi()
    for talk in talks:
        try:
            words = " ".join(s.text for s in api.fetch(video_id(talk["url"]), languages=["en"])).split()
        except Exception as err:  # one missing transcript should not stop the others
            print(f"skip {talk['id']}: {err}")
            continue
        for n, start in enumerate(range(0, len(words), WORDS_PER_CHUNK), 1):
            body = " ".join(words[start : start + WORDS_PER_CHUNK])
            front = {
                "id": f"{talk['id']}-{n:02d}",
                "source": [talk["id"]],
                "title": f"{talk['title']} (transcript part {n})",
                "topics": talk["topics"],
                "answers": talk["answers"],
            }
            text = f"---\n{yaml.safe_dump(front, sort_keys=False)}---\n{body}\n"
            (OUT / f"{front['id']}.md").write_text(text)
        print(f"ok {talk['id']}: {len(words)} words")


if __name__ == "__main__":
    main()
