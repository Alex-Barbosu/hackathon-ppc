import { AnimatePresence, motion } from "framer-motion";
import { Drawer } from "../../components/Drawer";
import { SPRING } from "../../components/motion/springs";
import { usePanels } from "../../state/panels";
import { DemoStepRow } from "./DemoStepRow";
import { DEMO_STEPS } from "./steps";
import { useDemo } from "./useDemo";

// The demo script as a checklist beside the live screens: one step open at a time, its proof and its button.
export function DemoPanel() {
  const open = usePanels((s) => s.open === "demo");
  const { close, show } = usePanels();
  const { at, done, started, stop } = useDemo();
  const title = (
    <div>
      <p className="font-display text-2xl leading-none">Demo</p>
      <p className="mt-1 text-xs text-faint tabular-nums">{done.size} of {DEMO_STEPS.length} done</p>
    </div>
  );
  const footer = (
    <div className="flex items-center justify-between border-t-[0.8px] border-line px-6 py-3 text-[13px]">
      <span className="text-faint">Esc closes, the demo keeps its place</span>
      <button type="button" onClick={() => { stop(); close(); }} className="text-muted hover:text-ink">End demo</button>
    </div>
  );
  return (
    <>
      <Drawer open={open} label="Demo" title={title} onClose={close} footer={footer}>
        <div className="h-0.5 bg-line" aria-hidden><motion.div className="h-full bg-white/70" animate={{ width: `${(done.size / DEMO_STEPS.length) * 100}%` }} transition={SPRING.soft} /></div>
        <ol className="p-3">{DEMO_STEPS.map((s, i) => <DemoStepRow key={s.title} index={i} step={s} />)}</ol>
      </Drawer>
      <AnimatePresence>
        {started && !open && (
          <motion.button type="button" onClick={() => show("demo")} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={SPRING.snappy}
            className="fixed bottom-5 left-5 z-40 rounded-full border-[0.8px] border-white/16 bg-[#111] px-4 py-2.5 text-[13px] shadow-[0_16px_40px_-12px_rgb(0_0_0/0.9)] hover:bg-[#191919] focus-visible:outline-2 focus-visible:outline-accent">
            Demo, step {at + 1} of {DEMO_STEPS.length}: <span className="text-muted">{DEMO_STEPS[at]?.title}</span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
