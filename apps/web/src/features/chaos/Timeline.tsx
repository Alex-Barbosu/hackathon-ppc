import { AnimatePresence, motion } from "framer-motion";
import type { ChaosState } from "./useChaos";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB");

export function Timeline({ state }: { state: ChaosState | undefined }) {
  // Newest first: during a demo the latest action is the one people look for.
  const log = [...(state?.log ?? [])].reverse();
  if (!log.length) return <p className="text-sm text-muted">Nothing triggered yet. Actions you run will appear here in order.</p>;
  return (
    <ol aria-label="Chaos timeline" className="space-y-2">
      <AnimatePresence initial={false}>
        {log.map((e) => (
          <motion.li key={`${e.at}-${e.action}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="flex gap-3 border-l-2 border-accent/40 pl-3 text-sm">
            <time dateTime={e.at} className="shrink-0 text-[13px] text-muted tabular-nums">{e.at ? clock(e.at) : ""}</time>
            <span>{e.action}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
