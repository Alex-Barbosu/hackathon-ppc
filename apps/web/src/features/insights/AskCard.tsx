import { Reveal } from "../../components/motion/Reveal";
import { CARD, Arrow, PrimaryButton } from "../../components/ui";
import { usePanels } from "../../state/panels";
import { SUGGESTIONS } from "./AnalystPanel";

// The chat itself lives in the side panel (on every screen); this card is the obvious way in from Insights.
export function AskCard() {
  const show = usePanels((s) => s.show);
  return (
    <Reveal as="section" className={`${CARD} grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:items-center`}>
      <div>
        <p className="label text-faint">Analyst</p>
        <h3 className="mt-3 font-display text-[32px] leading-[1.1] text-white/85 sm:text-[44px]">Ask about the <em>numbers</em>.</h3>
        <p className="mt-3 max-w-md text-[15px] text-muted">A chat that reads live metrics and aggregate views. It never sees file names, contents or personal data.</p>
        <PrimaryButton className="mt-6" onClick={() => show("analyst")}>Open the chat <Arrow /></PrimaryButton>
      </div>
      <div className="grid gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => show("analyst", s)}
            className="flex items-center justify-between gap-3 rounded-xl border-[0.8px] border-line bg-panel px-4 py-3.5 text-left text-[15px] transition-[background-color,transform] duration-300 hover:translate-x-1 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-accent">
            {s}<span className="text-faint" aria-hidden>↗</span>
          </button>
        ))}
      </div>
    </Reveal>
  );
}
