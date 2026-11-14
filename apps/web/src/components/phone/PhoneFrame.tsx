import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface PhoneFrameProps {
  children: ReactNode;
  tilt?: "left" | "right" | "none";
  label: string;
  className?: string;
}

const ANGLE = { left: { rotateY: 16, rotateX: 4, rotateZ: -2 }, right: { rotateY: -16, rotateX: 4, rotateZ: 2 }, none: { rotateY: 0, rotateX: 0, rotateZ: 0 } };

// A CSS 3D handset showing live FileGrid UI, in place of Origin's rendered phones.
// Pure CSS transforms keep it sharp at any size and cost nothing to load.
export function PhoneFrame({ children, tilt = "right", label, className = "" }: PhoneFrameProps) {
  const reduce = useReducedMotion();
  const pose = reduce ? ANGLE.none : ANGLE[tilt];
  return (
    <div className={`[perspective:1600px] ${className}`}>
      <motion.figure
        aria-label={label}
        initial={reduce ? false : { ...pose, y: 24, opacity: 0 }}
        animate={{ ...pose, y: 0, opacity: 1 }}
        whileHover={reduce ? undefined : { rotateY: pose.rotateY / 2, rotateX: 0, rotateZ: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className="relative mx-auto aspect-[9/19.2] w-[var(--phone-w,280px)] rounded-[48px] bg-[#1a1a1a] p-[10px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9),inset_0_0_0_1.5px_rgb(255_255_255/0.14),inset_0_0_0_4px_#0b0b0b] [transform-style:preserve-3d]"
      >
        <span aria-hidden className="absolute top-[110px] -left-[3px] h-8 w-[3px] rounded-l bg-[#2a2a2a]" />
        <span aria-hidden className="absolute top-[156px] -left-[3px] h-14 w-[3px] rounded-l bg-[#2a2a2a]" />
        <span aria-hidden className="absolute top-[170px] -right-[3px] h-20 w-[3px] rounded-r bg-[#2a2a2a]" />
        <div className="relative h-full overflow-hidden rounded-[38px] bg-[#0a0a0a]">
          <span aria-hidden className="absolute top-2.5 left-1/2 z-10 h-[26px] w-[86px] -translate-x-1/2 rounded-full bg-black" />
          <div className="flex items-center justify-between px-7 pt-3.5 text-[12px] font-medium" aria-hidden>
            <span>9:41</span>
            <span className="flex items-center gap-1"><span className="h-2 w-3.5 rounded-[2px] border border-white/70" /></span>
          </div>
          <div className="h-[calc(100%-40px)] overflow-hidden px-4 pt-5">{children}</div>
          {/* A faint diagonal reflection sells the glass without a glow. */}
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/[0.07] via-transparent to-transparent" />
        </div>
      </motion.figure>
    </div>
  );
}
