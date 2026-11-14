import { loadCorpus, searchKnowledge } from "../knowledge.js";

export interface KnowledgeSnippet { id: string; title: string; text: string }
/** Where the analyst's `search_knowledge` tool gets its text. The corpus arrives later (CLAUDE.md section 9). */
export interface KnowledgeSearch { search(query: string, limit: number): KnowledgeSnippet[] }

export const emptyKnowledge: KnowledgeSearch = { search: () => [] };

/** The hand-written chunks in services/insights/corpus, off by default: set ANALYST_KNOWLEDGE=corpus to try them. */
export function corpusKnowledge(): KnowledgeSearch {
  const chunks = loadCorpus();
  return { search: (q, limit) => searchKnowledge(chunks, q, { limit }).map((h) => ({ id: h.chunk.id, title: h.chunk.title, text: h.chunk.body.slice(0, 700) })) };
}

export const knowledgeFromEnv = (env: NodeJS.ProcessEnv): KnowledgeSearch => (env.ANALYST_KNOWLEDGE === "corpus" ? corpusKnowledge() : emptyKnowledge);
