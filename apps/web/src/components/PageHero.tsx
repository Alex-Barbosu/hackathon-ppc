import type { ReactNode } from "react";

interface PageHeroProps { label: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }

// A console header, not a landing-page hero: the people using FileGrid are trained operators who open
// a screen to do a job. One line says where they are, one says what the screen answers.
export function PageHero({ label, title, children, actions }: PageHeroProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b-[0.8px] border-line pt-6 pb-5 sm:pt-8">
      <div className="min-w-0">
        <p className="label text-faint">FileGrid / {label}</p>
        <h1 className="mt-1.5 font-display text-[28px] leading-tight sm:text-[32px]">{title}</h1>
      </div>
      {children && <p className="max-w-xl text-sm text-muted text-pretty sm:text-right">{children}</p>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

// A section heading inside a screen: small, left-aligned, with its one-line purpose beside it.
export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h2 className="font-display text-[22px] leading-tight">{children}</h2>
      {sub && <p className="max-w-2xl text-[13px] text-muted">{sub}</p>}
    </div>
  );
}
