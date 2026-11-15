import { motion, useMotionTemplate, useReducedMotion, useTransform } from "framer-motion";
import type { ReactNode } from "react";
import { SPRING } from "../motion/springs";
import { usePointerTilt } from "../motion/usePointerTilt";
import { PhoneBody } from "./PhoneBody";

interface PhoneFrameProps { children: ReactNode; tilt?: "left" | "right" | "none"; label: string; className?: string }

const POSE = { left: { ry: 18, rx: 5, rz: -2 }, right: { ry: -18, rx: 5, rz: 2 }, none: { ry: 0, rx: 0, rz: 0 } };

// A 3D handset built from real layers (see PhoneBody), showing live FileGrid UI. It leans with the
// pointer, so its edges, reflections and shadow all move like one solid object.
export function PhoneFrame({ children, tilt = "right", label, className = "" }: PhoneFrameProps) {
  const reduce = useReducedMotion();
  const pose = reduce ? POSE.none : POSE[tilt];
  const { x, y } = usePointerTilt();
  const rotateY = useTransform(x, (v) => pose.ry + v * 9);
  const rotateX = useTransform(y, (v) => pose.rx - v * 7);
  // The glass highlight slides the opposite way to the lean, as a reflection would.
  const sheen = useTransform(x, (v) => 30 - v * 40 - pose.ry);
  const sheenBg = useMotionTemplate`linear-gradient(115deg, transparent ${sheen}%, rgb(255 255 255 / 0.10) calc(${sheen}% + 9%), rgb(255 255 255 / 0.02) calc(${sheen}% + 22%), transparent calc(${sheen}% + 36%))`;
  const shadowX = useTransform(rotateY, (v) => v * -1.6);

  return (
    <div className={`relative [perspective:1500px] ${className}`}>
      <motion.div aria-hidden style={{ x: shadowX }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...SPRING.slow, delay: 0.2 }}
        className="absolute inset-x-[8%] -bottom-7 h-12 rounded-[50%] bg-black/70 blur-2xl" />
      <motion.figure aria-label={label} style={{ rotateX, rotateY, rotateZ: pose.rz, transformStyle: "preserve-3d" }}
        initial={reduce ? false : { y: 48, opacity: 0, scale: 0.94 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={SPRING.slow}
        className="relative mx-auto aspect-[9/19.2] w-[var(--phone-w,280px)]">
        <PhoneBody sheen={sheenBg}>{children}</PhoneBody>
      </motion.figure>
    </div>
  );
}
