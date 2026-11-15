import type { ReactNode } from "react";

interface PageHeroProps { title: ReactNode; actions?: ReactNode }

// A console header: just the screen's name. Trained operators know what each screen is for, so
// breadcrumbs and one-line explanations were noise (how things work belongs in the docs).
export function PageHero({ title, actions }: PageHeroProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b-[0.8px] border-line pt-6 pb-5 sm:pt-8">
      <h1 className="min-w-0 font-display text-[28px] leading-tight sm:text-[32px]">{title}</h1>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-[22px] leading-tight">{children}</h2>;
}
