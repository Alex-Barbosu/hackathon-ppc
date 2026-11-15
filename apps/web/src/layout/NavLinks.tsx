import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { SPRING } from "../components/motion/springs";
import { useAccess } from "../state/useAccess";
import { NAV } from "./nav";

// The highlight is one shared element that slides between links, so the eye follows where you went.
export function NavLinks() {
  const { pages } = useAccess();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-1 sm:order-none sm:w-auto sm:pb-0">
      {NAV.filter((n) => pages.includes(n.to)).map((n) => {
        const active = path === n.to;
        return (
          <Link key={n.to} to={n.to} aria-current={active ? "page" : undefined}
            className={`label relative whitespace-nowrap rounded-lg px-3 py-2 transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-accent ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
            {active && <motion.span layoutId="nav-pill" transition={SPRING.snappy} className="absolute inset-0 rounded-lg bg-white/12" />}
            <span className="relative">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
