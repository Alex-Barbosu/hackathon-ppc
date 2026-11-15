import { motion, type MotionValue } from "framer-motion";
import type { ReactNode } from "react";

// Brushed titanium: light catches the top-left and bottom-right edges of the band.
const BAND = "bg-[linear-gradient(140deg,#5b5b5f_0%,#2a2a2d_22%,#111113_55%,#2e2e31_82%,#56565a_100%)]";
const DEPTH = 11; // millimetre-ish thickness, in 1.4px slices
const slice = (i: number) => ({ transform: `translateZ(${-(i + 1) * 1.4}px)` });

function Key({ className }: { className: string }) {
  return <span aria-hidden style={{ transform: "translateZ(-8px)" }} className={`absolute w-[3.5px] bg-[linear-gradient(180deg,#4a4a4e,#1c1c1e_40%,#3a3a3d)] ${className}`} />;
}

/** The handset as stacked layers in real 3D space: a back plate, the band slices that give it an edge, then the glass. */
export function PhoneBody({ children, sheen }: { children: ReactNode; sheen: MotionValue<string> }) {
  return (
    <>
      {Array.from({ length: DEPTH }, (_, i) => (
        <span key={i} aria-hidden style={slice(i)} className={`absolute inset-0 rounded-[48px] ${i === DEPTH - 1 ? "bg-[#0a0a0b]" : BAND}`} />
      ))}
      <Key className="top-[18%] -left-[3px] h-[5%] rounded-l" />
      <Key className="top-[26%] -left-[3px] h-[9%] rounded-l" />
      <Key className="top-[37%] -left-[3px] h-[9%] rounded-l" />
      <Key className="top-[30%] -right-[3px] h-[14%] rounded-r" />
      <div className={`absolute inset-0 rounded-[48px] p-[3px] ${BAND} shadow-[inset_0_0_0_0.5px_rgb(255_255_255/0.25)]`}>
        <div className="relative h-full overflow-hidden rounded-[45px] bg-black p-[7px]">
          <div className="relative h-full overflow-hidden rounded-[38px] bg-[#0a0a0a]">
            <span aria-hidden className="absolute top-2.5 left-1/2 z-10 flex h-[26px] w-[86px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-2.5">
              <span className="size-2 rounded-full bg-[#10131c] ring-1 ring-white/10" />
            </span>
            <div className="flex items-center justify-between px-7 pt-3.5 text-[12px] font-medium" aria-hidden>
              <span>9:41</span>
              <span className="h-2 w-3.5 rounded-[2px] border border-white/70" />
            </div>
            <div className="h-[calc(100%-40px)] overflow-hidden px-4 pt-5">{children}</div>
            <span aria-hidden className="absolute bottom-1.5 left-1/2 h-1 w-[34%] -translate-x-1/2 rounded-full bg-white/30" />
            <motion.span aria-hidden style={{ background: sheen }} className="pointer-events-none absolute inset-0" />
          </div>
        </div>
      </div>
    </>
  );
}
