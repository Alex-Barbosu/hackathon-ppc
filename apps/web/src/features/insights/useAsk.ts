import { useCallback, useRef, useState } from "react";
import { API_BASE, authHeaders } from "../../api/client";
import type { SourceChip } from "../../lib/domain";
import { useSession } from "../../state/session";
import { createSseParser } from "./parseSse";

export interface AskState {
  status: "idle" | "asking" | "done" | "failed";
  steps: string[];
  answer: string;
  sources: SourceChip[];
  notice: string | null;
}
const IDLE: AskState = { status: "idle", steps: [], answer: "", sources: [], notice: null };

export function useAsk() {
  const [state, setState] = useState<AskState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  // One conversation id per page view, so a follow-up question has the earlier exchange.
  const conversationId = useRef(crypto.randomUUID());

  const ask = useCallback(async (question: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ ...IDLE, status: "asking" });
    try {
      const res = await fetch(`${API_BASE}/insights/ask`, {
        method: "POST", signal: ctrl.signal,
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ question, conversationId: conversationId.current }),
      });
      if (res.status === 401) useSession.getState().signOut();
      if (!res.ok || !res.body) throw new Error(`The analyst answered ${res.status}`);
      const parse = createSseParser();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const e of parse(value)) {
          setState((s) => ({
            ...s,
            steps: e.type === "tool_call" && e.text ? [...s.steps, e.text] : s.steps,
            answer: e.type === "text" ? s.answer + (e.text ?? "") : s.answer,
            sources: e.type === "sources" ? [...s.sources, ...(e.sources ?? [])] : s.sources,
            notice: e.type === "error" ? (e.text ?? "The AI analyst is unavailable.") : s.notice,
            status: e.type === "done" ? "done" : s.status,
          }));
        }
      }
      setState((s) => (s.status === "asking" ? { ...s, status: "done" } : s));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState((s) => ({ ...s, status: "failed", notice: e instanceof Error ? e.message : "The analyst is unreachable." }));
    }
  }, []);

  return { state, ask };
}
