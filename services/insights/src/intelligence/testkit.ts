import type Anthropic from "@anthropic-ai/sdk";
import type { Db, Row } from "./db.js";
import type { Llm } from "./llm.js";
import type { PromLike, PromSample, PromSummary } from "./prom.js";

export interface Recorded { sql: string; params: unknown[] }

/** A pg stand-in: records every query and answers from `answer`. */
export function fakeDb(answer: (sql: string, params: unknown[]) => Row[] = () => []): Db & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  return { calls, async query(sql, params = []) { calls.push({ sql, params }); return { rows: answer(sql, params) }; } };
}

export const textMessage = (text: string): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "fake", content: [{ type: "text", text, citations: null }], stop_reason: "end_turn", stop_sequence: null, usage: {} }) as unknown as Anthropic.Message;

export const toolMessage = (name: string, input: unknown, id = "tu_1"): Anthropic.Message =>
  ({ id: "m", type: "message", role: "assistant", model: "fake", content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", stop_sequence: null, usage: {} }) as unknown as Anthropic.Message;

export type Scripted = Anthropic.Message | Error;

/** Replies from a script, in order, and keeps the requests so tests can inspect what would have been sent. */
export function fakeLlm(script: Scripted[]): Llm & { requests: Anthropic.MessageCreateParamsNonStreaming[] } {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const next = (): Anthropic.Message => {
    const r = script.shift();
    if (!r) throw new Error("fake llm script exhausted");
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    requests,
    async create(p) { requests.push(structuredClone(p)); return next(); },
    async stream(p, onText) {
      requests.push(structuredClone(p));
      const m = next();
      for (const b of m.content) if (b.type === "text") onText(b.text);
      return m;
    },
  };
}

export function fakeProm(instant: PromSample[] = [], range: PromSummary[] = []): PromLike & { asked: string[] } {
  const asked: string[] = [];
  return { asked, async instant(q) { asked.push(q); return instant; }, async range(q) { asked.push(q); return range; } };
}
