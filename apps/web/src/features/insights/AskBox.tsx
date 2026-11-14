import { useState } from "react";
import { CARD, FIELD, PrimaryButton } from "../../components/ui";
import { SourceChips } from "./SourceChips";
import { useAsk } from "./useAsk";

const SUGGESTIONS = [
  "How did today's storm compare with a normal day, and what should we change?",
  "Which storage fits each category, and why?",
  "Are the meters healthy right now?",
];

export function AskBox() {
  const [q, setQ] = useState("");
  const { state, ask } = useAsk();
  const busy = state.status === "asking";
  const send = (text: string) => { if (text.trim() && !busy) void ask(text.trim()); };
  return (
    <section aria-label="Ask the analyst" className={`${CARD} p-6 sm:p-10`}>
      <p className="label text-faint">Analyst</p>
      <h3 className="mt-3 font-display text-[28px] leading-[1.15] text-white/80 sm:text-4xl">Ask about the <em>numbers</em>.</h3>
      <p className="mt-3 max-w-xl text-sm text-muted">Answers use live metrics and aggregate views only. No file names, contents or personal data ever reach the model.</p>
      <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input aria-label="Your question" className={FIELD} value={q} maxLength={1000} placeholder="Ask about latency, throughput, storms, meters" onChange={(e) => setQ(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy || !q.trim()} className="sm:shrink-0">{busy ? "Working" : "Ask"}</PrimaryButton>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => <button type="button" key={s} disabled={busy} className="rounded-lg border-[0.8px] border-line bg-surface px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" onClick={() => { setQ(s); send(s); }}>{s}</button>)}
      </div>
      {state.status !== "idle" && (
        <div className="mt-6 space-y-3" aria-live="polite">
          {busy && !state.answer && <p className="text-sm text-muted">{state.steps.at(-1) ?? "Reading the question"}…</p>}
          {state.notice && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{state.notice}</p>}
          {state.answer && <p className="max-w-2xl text-base leading-7 whitespace-pre-wrap text-white/90">{state.answer}</p>}
          <SourceChips sources={state.sources} />
        </div>
      )}
    </section>
  );
}
