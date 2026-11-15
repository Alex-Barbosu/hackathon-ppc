import { usePanels } from "../../state/panels";

// Bottom-right on every screen for roles with the analyst: a chat should be where people look for one.
export function AnalystLauncher() {
  const { open, show } = usePanels();
  if (open) return null;
  return (
    <button type="button" onClick={() => show("analyst")}
      className="fixed right-4 bottom-4 z-40 inline-flex min-h-12 items-center gap-2.5 rounded-full bg-white py-3 pr-5 pl-4 text-sm font-medium text-black shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:right-6 sm:bottom-6">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5v6a1.5 1.5 0 0 1-1.5 1.5H8l-3.5 3v-3h0A1.5 1.5 0 0 1 3 10.5z" /></svg>
      Ask the analyst
    </button>
  );
}
