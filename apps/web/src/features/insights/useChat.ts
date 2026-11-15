import { useCallback, useRef, useState } from "react";
import { API_BASE, authHeaders } from "../../api/client";
import type { AnalystEvent, SourceChip } from "../../lib/domain";
import { useSession } from "../../state/session";
import { createSseParser } from "./parseSse";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: string[];
  sources: SourceChip[];
  notice: string | null;
  status: "streaming" | "done" | "failed";
}

const turn = (role: ChatMessage["role"], text = ""): ChatMessage =>
  ({ id: crypto.randomUUID(), role, text, steps: [], sources: [], notice: null, status: role === "user" ? "done" : "streaming" });

function apply(m: ChatMessage, e: AnalystEvent): ChatMessage {
  return {
    ...m,
    steps: e.type === "tool_call" && e.text ? [...m.steps, e.text] : m.steps,
    text: e.type === "text" ? m.text + (e.text ?? "") : m.text,
    sources: e.type === "sources" ? [...m.sources, ...(e.sources ?? [])] : m.sources,
    notice: e.type === "error" ? (e.text ?? "The AI analyst is unavailable.") : m.notice,
    status: e.type === "done" ? "done" : m.status,
  };
}

// A chat thread kept for the page session; the server keeps the last few turns per conversation id,
// so a follow-up ("and yesterday?") is understood.
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const conversationId = useRef(crypto.randomUUID());
  const abort = useRef<AbortController | null>(null);
  const busy = messages.at(-1)?.status === "streaming";

  const patchLast = (f: (m: ChatMessage) => ChatMessage) => setMessages((ms) => [...ms.slice(0, -1), f(ms[ms.length - 1]!)]);

  const send = useCallback(async (question: string) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setMessages((ms) => [...ms, turn("user", question), turn("assistant")]);
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
        for (const e of parse(value)) patchLast((m) => apply(m, e));
      }
      patchLast((m) => (m.status === "streaming" ? { ...m, status: "done" } : m));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      patchLast((m) => ({ ...m, status: "failed", notice: e instanceof Error ? e.message : "The analyst is unreachable." }));
    }
  }, []);

  const reset = () => { abort.current?.abort(); setMessages([]); conversationId.current = crypto.randomUUID(); };
  return { messages, busy, send, reset };
}
