import { AnimatePresence, motion } from "framer-motion";
import { useToasts } from "./toasts";

export function Toasts() {
  const { items, dismiss } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="glass pointer-events-auto flex items-start justify-between gap-3 rounded-2xl p-4 text-sm">
            <span>{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">Dismiss</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
