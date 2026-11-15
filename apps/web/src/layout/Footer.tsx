import { Reveal } from "../components/motion/Reveal";
import { Link } from "@tanstack/react-router";
import { GridMark } from "../components/phone/PhoneScreen";
import { TexturePanel, Scrim } from "../components/Texture";
import { NAV } from "./nav";
import { useAccess } from "../state/useAccess";

const GUARANTEES = ["Meter readings never lost or duplicated", "Outage records available at once", "Personal data encrypted and audited", "Drone video resumes on bad links"];

// Origin closes every page on a landscape band and a quiet link grid; ours restates the four guarantees.
export function Footer() {
  const { pages } = useAccess();
  return (
    <footer className="pb-6">
      <TexturePanel texture="field" className="flex min-h-[420px] flex-col items-center justify-center px-6 py-20 text-center">
        <Reveal><h2 className="font-display text-[40px] leading-[1.05] text-balance sm:text-[64px]">One door for every <em>file</em>.</h2></Reveal>
        <Reveal delay={0.12} className="mt-10 w-full max-w-3xl"><Scrim texture="field" className="p-6">
          <ul className="grid gap-x-8 gap-y-3 text-left text-[15px] sm:grid-cols-2">
            {GUARANTEES.map((g) => <li key={g} className="flex items-center gap-3"><span className="size-1.5 shrink-0 rounded-full bg-white" aria-hidden />{g}</li>)}
          </ul>
        </Scrim></Reveal>
      </TexturePanel>
      <div className="grid gap-10 px-2 pt-14 pb-6 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="flex items-center gap-2.5 text-base font-medium"><GridMark /> FileGrid</p>
          <p className="mt-3 max-w-sm text-sm text-faint">The single entry point for operational files at Rețele Electrice România, PPC group.</p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-3">
          {NAV.filter((n) => pages.includes(n.to)).map((n) => <Link key={n.to} to={n.to} className="label text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">{n.label}</Link>)}
        </nav>
      </div>
      <p className="border-t-[0.8px] border-line px-2 pt-6 text-[13px] text-faint">Every stored file carries a SHA-256 receipt. Storages are reachable only through FileGrid.</p>
    </footer>
  );
}
