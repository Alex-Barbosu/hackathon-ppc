import { useEffect, useRef, useState } from "react";
import { Drawer } from "../../components/Drawer";
import { usePanels } from "../../state/panels";
import { ChatMessages } from "./ChatMessages";
import { useChat } from "./useChat";
import { useSession } from "../../state/session";
import { useStoragesHealth } from "../operations/useStoragesHealth";
import { ANALYST_NAME, greeting, VoltaMark } from "./Volta";

export const SUGGESTIONS = [
  "How did today's storm compare with a normal day?",
  "Which storage fits each category, and why?",
  "Are the meters healthy right now?",
  "Where are the outage hotspots?",
];

export function AnalystPanel() {
  const { open, draft, close } = usePanels();
  const isOpen = open === "analyst";
  const { messages, busy, send, reset } = useChat();
  const [q, setQ] = useState("");
  const role = useSession((s) => s.session?.role);
  const health = useStoragesHealth().data;
  const down = health?.filter((s) => !s.up).length ?? 0;
  const end = useRef<HTMLDivElement>(null);
  const go = (text: string) => { if (text.trim() && !busy) { void send(text.trim()); setQ(""); } };
  // A suggestion clicked elsewhere (Insights page) arrives as a draft and is asked straight away.
  useEffect(() => { if (isOpen && draft) { go(draft); usePanels.setState({ draft: null }); } }, [isOpen, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const composer = (
    <form className="flex gap-2 border-t-[0.8px] border-line p-3" onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <input aria-label={`Message ${ANALYST_NAME}`} value={q} maxLength={1000} onChange={(e) => setQ(e.target.value)} placeholder={`Ask ${ANALYST_NAME} about latency, storms, meters…`}
        className="min-h-12 flex-1 rounded-xl border-[0.8px] border-white/12 bg-surface px-4 text-[15px] placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent" />
      <button type="submit" disabled={busy || !q.trim()} aria-label="Send"
        className="grid size-12 shrink-0 place-items-center rounded-xl bg-white text-black transition-opacity disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /></svg>
      </button>
    </form>
  );
  const title = (
    <div className="flex items-center gap-3">
      <VoltaMark busy={busy} size={36} />
      <div>
        <p className="font-display text-2xl leading-none">{ANALYST_NAME}</p>
        <p className={`mt-1 text-xs ${down && !busy ? "text-warn" : "text-faint"}`}>
          {busy ? "Reading the metrics…" : down ? `Watching: ${down} storage${down === 1 ? "" : "s"} down` : "Grid analyst · all storages up"}
        </p>
      </div>
    </div>
  );
  return (
    <Drawer open={isOpen} label="Analyst chat" title={title} onClose={close} footer={composer}>
      {messages.length === 0 ? (
        <div className="space-y-4 p-6">
          <p className="text-[15px] leading-relaxed">{greeting(role)}</p>
          <p className="text-[13px] text-faint">I only see metrics and aggregates, never file names, contents or personal data. Every number I give links to the query behind it.</p>
          <div className="grid gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => go(s)} className="rounded-xl border-[0.8px] border-line bg-surface px-4 py-3 text-left text-[15px] transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-accent">{s}</button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <ChatMessages messages={messages} />
          <div className="px-6 pb-4"><button type="button" onClick={reset} className="caption text-muted hover:text-ink">New conversation</button></div>
          <div ref={end} />
        </>
      )}
    </Drawer>
  );
}
