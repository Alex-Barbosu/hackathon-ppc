import { useEffect, useRef, useState, type KeyboardEvent } from "react";

// Keyboard and focus rules of the WAI-ARIA select-only combobox, kept apart from the markup.
export function useListbox<T>(options: readonly { value: T }[], value: T, onChange: (v: T) => void) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const show = () => { setActive(selected); setOpen(true); };
  const pick = (i: number) => { const o = options[i]; if (o) onChange(o.value); setOpen(false); };

  const onKeyDown = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = (i: number) => { e.preventDefault(); if (!open) show(); else setActive(Math.min(last, Math.max(0, i))); };
    switch (e.key) {
      case "ArrowDown": return move(active + 1);
      case "ArrowUp": return move(active - 1);
      case "Home": return move(0);
      case "End": return move(last);
      case "Enter": case " ": e.preventDefault(); return open ? pick(active) : show();
      case "Escape": case "Tab": if (open) { if (e.key === "Escape") e.preventDefault(); setOpen(false); } return;
    }
  };

  return { open, active, root, setActive, toggle: () => (open ? setOpen(false) : show()), pick, onKeyDown };
}
