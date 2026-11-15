import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { SPRING } from "../components/motion/springs";
import { GRAFANA_HOME } from "../lib/grafana";
import { usePanels } from "../state/panels";
import { useSession } from "../state/session";
import { useAccess } from "../state/useAccess";
import { NAV } from "./nav";

interface Command { id: string; label: string; hint: string; run: () => void }

// Ctrl/Cmd+K: trained operators move by keyboard. Every screen and panel is one short query away.
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const navigate = useNavigate();
  const access = useAccess();
  const show = usePanels((s) => s.show);
  const signOut = useSession((s) => s.signOut);

  const commands = useMemo<Command[]>(() => [
    ...NAV.filter((n) => access.pages.includes(n.to)).map((n) => ({ id: n.to, label: n.label, hint: "Go to", run: () => void navigate({ to: n.to }) })),
    ...(access.analyst ? [{ id: "analyst", label: "Ask Volta, the analyst", hint: "Open", run: () => show("analyst") }] : []),
    ...(access.chaos ? [{ id: "chaos", label: "Chaos controls", hint: "Open", run: () => show("chaos") }] : []),
    ...(access.pages.includes("/operations") ? [{ id: "grafana", label: "Grafana dashboards", hint: "New tab", run: () => void window.open(GRAFANA_HOME, "_blank", "noopener") }] : []),
    { id: "signout", label: "Sign out", hint: "Session", run: () => { signOut(); void navigate({ to: "/login" }); } },
  ], [access, navigate, show, signOut]);
  const found = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); setQ(""); setAt(0); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const pick = (c: Command | undefined) => { if (c) { setOpen(false); c.run(); } };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-start justify-center bg-black/60 px-4 pt-[18vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
          <motion.div role="dialog" aria-label="Command palette" initial={{ y: -8, scale: 0.98 }} animate={{ y: 0, scale: 1 }} transition={SPRING.snappy}
            onClick={(e) => e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-widget border-[0.8px] border-white/16 bg-[#111] shadow-[0_32px_80px_-16px_rgb(0_0_0/0.95)]">
            <input autoFocus value={q} placeholder="Type a command or a screen…" aria-label="Command" onChange={(e) => { setQ(e.target.value); setAt(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, found.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter") pick(found[at]);
              }}
              className="w-full border-b-[0.8px] border-line bg-transparent px-5 py-4 text-base outline-none placeholder:text-faint" />
            <ul role="listbox" className="max-h-80 overflow-y-auto p-1.5">
              {found.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === at} onPointerEnter={() => setAt(i)} onClick={() => pick(c)}
                  className={`flex cursor-pointer items-center justify-between rounded-lg px-3.5 py-2.5 text-[15px] ${i === at ? "bg-white/10" : ""}`}>
                  {c.label}<span className="label text-faint">{c.hint}</span>
                </li>
              ))}
              {found.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">Nothing matches.</li>}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
