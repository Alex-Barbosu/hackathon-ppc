import type { ReactNode } from "react";

interface PageHeroProps {
  label: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}

// Origin's section opener: mono label, light serif headline with one italic word, short muted line, centred.
export function PageHero({ label, title, children, actions }: PageHeroProps) {
  return (
    <header className="mx-auto flex max-w-4xl flex-col items-center px-2 pt-10 pb-4 text-center sm:pt-16">
      <p className="label text-faint">{label}</p>
      <h1 className="mt-5 font-display text-[44px] leading-[1.05] tracking-[-0.5px] text-balance sm:text-[64px] lg:text-[80px] lg:leading-none lg:tracking-[-0.8px]">
        {title}
      </h1>
      {children && <p className="mt-6 max-w-xl text-base leading-6 text-muted text-pretty">{children}</p>}
      {actions && <div className="mt-8 flex flex-wrap justify-center gap-3">{actions}</div>}
    </header>
  );
}

// A smaller centred heading between sections, Origin's 48px section title.
export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="font-display text-[34px] leading-[1.15] text-balance sm:text-5xl">{children}</h2>
      {sub && <p className="mt-4 text-base text-muted text-pretty">{sub}</p>}
    </div>
  );
}
