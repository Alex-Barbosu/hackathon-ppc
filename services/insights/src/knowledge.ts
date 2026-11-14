// Knowledge corpus for the grid analyst's future `search_knowledge(query)` tool.
// Deliberately a keyword scorer, not embeddings: ~20 hand-written chunks fit in memory and a
// transparent ranking is easier to defend to judges than a vector store we would have to run.
// Swap `searchKnowledge` for an embedding search later without changing callers.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Section5Question = "storage-fit" | "peak-vs-normal" | "meter-anomalies" | "outage-hotspots" | "observability";

export interface KnowledgeChunk {
  id: string;
  title: string;
  source: string[];
  topics: string[];
  answers: string[];
  body: string;
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk;
  score: number;
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

// Our front matter is flat `key: value` or `key: [a, b]`; a YAML dependency is not worth it.
export function parseChunk(text: string): KnowledgeChunk | undefined {
  const match = FRONT_MATTER.exec(text);
  if (!match) return undefined;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at > 0 && !line.startsWith(" ")) fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const list = (key: string): string[] =>
    (fields.get(key) ?? "").replace(/^\[|\]$/g, "").split(",").map((v) => v.trim()).filter(Boolean);
  const id = fields.get("id");
  if (!id) return undefined;
  return { id, title: fields.get("title") ?? id, source: list("source"), topics: list("topics"), answers: list("answers"), body: (match[2] ?? "").trim() };
}

// Transcripts (gitignored) are loaded when a developer has fetched them locally.
export function loadCorpus(root = new URL("../corpus", import.meta.url).pathname): KnowledgeChunk[] {
  const dirs = [join(root, "chunks"), join(root, ".transcripts")].filter((d) => existsSync(d));
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => parseChunk(readFileSync(join(dir, f), "utf8")))
      .filter((c): c is KnowledgeChunk => c !== undefined),
  );
}

const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9ăâîșțşţ]+/).filter((t) => t.length > 2);

// Title and topic matches weigh more than body matches because they were chosen by hand.
export function searchKnowledge(chunks: KnowledgeChunk[], query: string, opts: { limit?: number; answers?: Section5Question } = {}): KnowledgeHit[] {
  const terms = new Set(tokens(query));
  return chunks
    .filter((c) => !opts.answers || c.answers.includes(opts.answers))
    .map((chunk) => {
      const head = new Set(tokens(`${chunk.title} ${chunk.topics.join(" ")}`));
      const body = tokens(chunk.body);
      let score = 0;
      for (const t of terms) score += (head.has(t) ? 3 : 0) + Math.min(body.filter((b) => b === t).length, 5);
      return { chunk, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3);
}
