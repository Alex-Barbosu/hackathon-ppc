import { AnimatePresence, motion } from "framer-motion";
import { useId } from "react";
import { useListbox } from "./useListbox";

export interface SelectOption<T extends string> { value: T; label: string; hint?: string; group?: string }

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

// A styled replacement for <select>: the native menu cannot be themed, and it broke the dark look.
export function Select<T extends string>({ label, value, options, onChange, hideLabel, disabled, className = "" }: SelectProps<T>) {
  const id = useId();
  const lb = useListbox(options, value, onChange);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={lb.root} className={`relative ${className}`}>
      <span id={`${id}-l`} className={hideLabel ? "sr-only" : "label mb-2 block text-faint"}>{label}</span>
      <button type="button" role="combobox" aria-haspopup="listbox" aria-expanded={lb.open} aria-controls={`${id}-lb`}
        aria-labelledby={`${id}-l ${id}-v`} aria-activedescendant={lb.open ? `${id}-${lb.active}` : undefined}
        disabled={disabled} onClick={lb.toggle} onKeyDown={lb.onKeyDown}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border-[0.8px] border-white/12 bg-surface px-4 text-left text-base transition-colors hover:border-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40">
        <span id={`${id}-v`} className="truncate">{current?.label ?? "Choose"}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`shrink-0 transition-transform ${lb.open ? "rotate-180" : ""}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {lb.open && (
          <motion.ul id={`${id}-lb`} role="listbox" aria-labelledby={`${id}-l`}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="absolute z-50 mt-2 max-h-72 w-full min-w-56 origin-top overflow-y-auto rounded-xl border-[0.8px] border-white/14 bg-[#161616] p-1.5 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]">
            {options.map((o, i) => (
              <li key={o.value} role="presentation">
                {o.group && o.group !== options[i - 1]?.group && <p className="label px-3 pt-3 pb-1.5 text-[11px] text-faint">{o.group}</p>}
                <div id={`${id}-${i}`} role="option" aria-selected={o.value === value}
                  onPointerEnter={() => lb.setActive(i)} onClick={() => lb.pick(i)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[15px] ${i === lb.active ? "bg-white/8" : ""}`}>
                  <span><span className="block">{o.label}</span>{o.hint && <span className="block text-xs text-faint">{o.hint}</span>}</span>
                  {o.value === value && <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="m3 7.5 2.5 2.5L11 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
