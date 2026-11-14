import { parseBlocks, type Inline } from "./answerBlocks";

const Line = ({ parts }: { parts: Inline[] }) => <>{parts.map((p, i) => (p.bold ? <strong key={i} className="font-medium text-white">{p.text}</strong> : <span key={i}>{p.text}</span>))}</>;

export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-6 text-white/85">
      {parseBlocks(text).map((b, i) =>
        b.kind === "p" ? <p key={i} className={/^confidence:/i.test(b.parts[0]?.text ?? "") ? "text-[13px] text-faint" : undefined}><Line parts={b.parts} /></p>
        : b.kind === "ul" ? <ul key={i} className="space-y-1.5">{b.items.map((it, j) => <li key={j} className="flex gap-2.5"><span aria-hidden className="mt-2.5 size-1 shrink-0 rounded-full bg-white/60" /><span><Line parts={it} /></span></li>)}</ul>
        : <ol key={i} className="list-decimal space-y-1.5 pl-5 marker:text-faint">{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ol>)}
    </div>
  );
}
