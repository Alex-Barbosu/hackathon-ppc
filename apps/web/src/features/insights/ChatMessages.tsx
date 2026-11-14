import { SourceChips } from "./SourceChips";
import { RichText } from "./RichText";
import type { ChatMessage } from "./useChat";

function Assistant({ m }: { m: ChatMessage }) {
  const working = m.status === "streaming" && !m.text;
  return (
    <div className="space-y-3">
      <p className="label text-faint">Analyst</p>
      {working && (
        <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          <span className="inline-flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-1 animate-pulse rounded-full bg-white/60" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
          {m.steps.at(-1) ?? "Reading the question"}
        </p>
      )}
      {m.notice && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{m.notice}</p>}
      {m.text && <RichText text={m.text} />}
      {m.status !== "streaming" && m.sources.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-faint hover:text-ink">{m.sources.length} numbers used</summary>
          <div className="mt-2"><SourceChips sources={m.sources} /></div>
        </details>
      )}
    </div>
  );
}

export function ChatMessages({ messages }: { messages: readonly ChatMessage[] }) {
  return (
    <ol className="space-y-6 p-6" aria-live="polite">
      {messages.map((m) => (
        <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
          {m.role === "user"
            ? <p className="max-w-[85%] rounded-2xl rounded-br-md bg-white px-4 py-2.5 text-[15px] text-black">{m.text}</p>
            : <Assistant m={m} />}
        </li>
      ))}
    </ol>
  );
}
