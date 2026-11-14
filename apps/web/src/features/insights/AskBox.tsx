import { useState } from "react";
import { FIELD, PrimaryButton, SecondaryButton } from "../../components/ui";
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
    <section aria-label="Ask the analyst" className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <h3 className="font-display text-lg">Ask the analyst</h3>
      <p className="mt-1 max-w-xl text-[13px] text-muted">Answers use live metrics and aggregate views only. No file names, contents or personal data ever reach the model.</p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); send(q); }}>
        <input aria-label="Your question" className={FIELD} value={q} maxLength={1000} placeholder="Ask about latency, throughput, storms, meters" onChange={(e) => setQ(e.target.value)} />
        <PrimaryButton type="submit" disabled={busy || !q.trim()} className="sm:shrink-0">{busy ? "Working" : "Ask"}</PrimaryButton>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => <SecondaryButton key={s} disabled={busy} className="!px-3 !py-1.5 text-[13px]" onClick={() => { setQ(s); send(s); }}>{s}</SecondaryButton>)}
      </div>
      {state.status !== "idle" && (
        <div className="mt-6 space-y-3" aria-live="polite">
          {busy && !state.answer && <p className="text-sm text-muted">{state.steps.at(-1) ?? "Reading the question"}…</p>}
          {state.notice && <p className="rounded-xl bg-warn/10 px-3 py-2 text-[13px] text-warn">{state.notice}</p>}
          {state.answer && <p className="max-w-2xl text-[15px] leading-relaxed whitespace-pre-wrap">{state.answer}</p>}
          <SourceChips sources={state.sources} />
        </div>
      )}
    </section>
  );
}
