import { usePanels } from "../../state/panels";
import { ANALYST_NAME, VoltaMark } from "./Volta";

// Bottom-right on every screen for roles with the analyst: a chat should be where people look for one.
export function AnalystLauncher() {
  const { open, show } = usePanels();
  if (open) return null;
  return (
    <button type="button" onClick={() => show("analyst")}
      className="fixed right-4 bottom-4 z-40 inline-flex min-h-10 items-center gap-2.5 rounded-full bg-white py-2 pr-4 pl-2 text-sm font-medium text-black shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:right-6 sm:bottom-6">
      <span className="rounded-full bg-black p-0.5"><VoltaMark size={22} /></span>
      Ask {ANALYST_NAME}
    </button>
  );
}
