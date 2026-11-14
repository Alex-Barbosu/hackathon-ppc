import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

interface DrawerProps { open: boolean; title: ReactNode; label: string; onClose: () => void; children: ReactNode; footer?: ReactNode }

// A right-hand sheet. No dimming scrim: the page behind stays readable, so a chaos action and the
// Operations charts it affects are on screen together.
export function Drawer({ open, title, label, onClose, children, footer }: DrawerProps) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside ref={panel} tabIndex={-1} role="dialog" aria-label={label}
          initial={reduce ? { opacity: 0 } : { x: "105%" }} animate={reduce ? { opacity: 1 } : { x: 0 }} exit={reduce ? { opacity: 0 } : { x: "105%" }}
          transition={{ type: "spring", stiffness: 300, damping: 34 }}
          className="fixed top-3 right-3 bottom-3 z-50 flex w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-card border-[0.8px] border-white/14 bg-[#0e0e0e] shadow-[0_32px_80px_-24px_rgb(0_0_0/0.95)] outline-none sm:w-[440px]">
          <header className="flex items-center justify-between gap-3 border-b-[0.8px] border-line py-3 pr-3 pl-6">
            <div className="min-w-0">{title}</div>
            <button type="button" onClick={onClose} aria-label={`Close ${label}`}
              className="grid size-10 place-items-center rounded-lg bg-white/8 hover:bg-white/14 focus-visible:outline-2 focus-visible:outline-accent">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </header>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
