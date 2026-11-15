import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "../../components/motion/springs";
import { Arrow, PrimaryButton } from "../../components/ui";
import type { DemoStep } from "./steps";
import { useDemo } from "./useDemo";
import { useRunStep } from "./useRunStep";

export function DemoStepRow({ index, step }: { index: number; step: DemoStep }) {
  const { at, done, goTo, complete } = useDemo();
  const { run, pending } = useRunStep();
  const current = index === at;
  const finished = done.has(index);
  return (
    <li className={`rounded-xl transition-colors ${current ? "bg-white/6" : ""}`}>
      <button type="button" onClick={() => goTo(index)} aria-expanded={current}
        className="flex w-full items-baseline gap-3 px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-accent">
        <span className={`w-5 shrink-0 text-[13px] tabular-nums ${finished ? "text-good" : "text-faint"}`}>{finished ? "✓" : index + 1}</span>
        <span className={`text-[15px] ${finished && !current ? "text-muted" : ""}`}>{step.title}</span>
      </button>
      <AnimatePresence initial={false}>
        {current && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING.snappy} className="overflow-hidden">
            <div className="space-y-3 pr-3 pb-4 pl-11">
              <p className="text-[14px] text-white/85">{step.proof}</p>
              <p className="text-[13px] text-faint">Proves: {step.proves}</p>
              <div className="flex items-center gap-3">
                <PrimaryButton className="min-h-10" disabled={pending} onClick={() => run(index, step.action)}>{pending ? "Working…" : step.button} <Arrow /></PrimaryButton>
                {!finished && <button type="button" onClick={() => complete(index)} className="text-[13px] text-muted hover:text-ink">Skip</button>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
