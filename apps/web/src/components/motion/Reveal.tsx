import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { RISE, SPRING } from "./springs";

interface RevealProps { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" | "li" | "article" }

// Content rises into place the first time it scrolls into view, then stays put.
export function Reveal({ children, className, delay = 0, as = "div" }: RevealProps) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  if (reduce) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag className={className} variants={RISE} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.15 }} transition={{ ...SPRING.soft, delay }}>
      {children}
    </Tag>
  );
}

interface StaggerProps { children: ReactNode; className?: string; gap?: number; as?: "div" | "ul" | "ol" | "dl" | "section" }

// A group whose children arrive one after another. Children must be <StaggerItem>.
export function Stagger({ children, className, gap = 0.07, as = "div" }: StaggerProps) {
  const Tag = motion[as];
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.08 }} variants={{ hidden: {}, shown: { transition: { staggerChildren: gap } } }}>
      {children}
    </Tag>
  );
}

export function StaggerItem({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" | "article" }) {
  const Tag = motion[as];
  return <Tag className={className} variants={RISE} transition={SPRING.soft}>{children}</Tag>;
}
