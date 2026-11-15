import type { ButtonHTMLAttributes, ReactNode } from "react";

// Origin's button voice: Roboto Mono capitals, 8px radius, white on black for the one action that matters.
const BASE =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-[18px] py-3 font-mono text-xs font-medium uppercase tracking-label transition-[background-color,transform,opacity] duration-200 active:scale-[0.97] [&>svg]:transition-transform [&>svg]:duration-300 hover:[&>svg]:translate-x-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40";

export function PrimaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${BASE} bg-accent text-accent-ink hover:bg-[#e8e8e8] ${props.className ?? ""}`} />;
}

export function SecondaryButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${BASE} bg-white/10 text-ink hover:bg-white/16 ${props.className ?? ""}`} />;
}

export const FIELD =
  "min-h-12 w-full rounded-lg border-[0.8px] border-white/12 bg-surface px-4 text-base font-light text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export const CARD = "rounded-card border-[0.8px] border-line bg-surface transition-colors duration-500 hover:border-white/14";
export const WIDGET = "overflow-hidden rounded-widget border-[0.8px] border-line bg-panel";

export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7h10M8 3l4 4-4 4" />
    </svg>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`caption text-muted ${className}`}>{children}</p>;
}

type Tone = "good" | "bad" | "warn" | "info" | "neutral";
const CHIP: Record<Tone, string> = { good: "text-good", bad: "text-bad", warn: "text-warn", info: "text-info", neutral: "text-muted" };

// Status is a coloured word, not a filled tag: boxed pills beside every title read as decoration.
export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap text-[13px] font-normal ${CHIP[tone]}`}>{children}</span>;
}

// A notice card: mono label, serif headline at 80% white, Inter body. Origin's event card.
export function Notice({ label, meta, title, children }: { label: string; meta?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className={`${CARD} flex flex-col gap-3 p-6`}>
      <div className="flex items-baseline justify-between gap-3">
        <Label>{label}</Label>
        {meta && <span className="text-[13px] text-faint">{meta}</span>}
      </div>
      <h3 className="font-display text-[28px] leading-[1.15] text-white/80 sm:text-4xl">{title}</h3>
      {children && <div className="text-lg leading-[1.42] tracking-[-0.2px] sm:text-xl">{children}</div>}
    </div>
  );
}
