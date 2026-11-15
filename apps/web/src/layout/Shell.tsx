import { useEffect } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { SPRING } from "../components/motion/springs";
import { GridMark } from "../components/phone/PhoneScreen";
import { useSession } from "../state/session";
import { Footer } from "./Footer";
import { NavLinks } from "./NavLinks";
import { useAccess } from "../state/useAccess";
import { usePanels } from "../state/panels";
import { ChaosDock } from "../features/chaos/ChaosDock";
import { Toasts } from "../features/chaos/Toasts";
import { AnalystLauncher } from "../features/insights/AnalystLauncher";
import { AnalystPanel } from "../features/insights/AnalystPanel";
import { UserMenu } from "./UserMenu";

export function Shell() {
  const signedIn = useSession((s) => s.session !== null);
  const navigate = useNavigate();
  const access = useAccess();
  const panels = usePanels();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const reduce = useReducedMotion();
  // The API signs us out on a 401; send the user to Login instead of leaving a dead page.
  useEffect(() => {
    if (!signedIn) void navigate({ to: "/login" });
  }, [signedIn, navigate]);
  // A new screen starts at its top, like a page load would.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [path]);

  return (
    <div className="mx-auto max-w-[1424px] px-4 pt-4 sm:px-6 sm:pt-6">
      {/* Origin's floating bar: 56px, 12px radius. Frosted, so the page is sensed moving underneath. */}
      <motion.header initial={reduce ? false : { y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={SPRING.soft}
        className="sticky top-4 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border-[0.8px] border-line bg-[#0b0b0b]/75 py-1 pr-1 pl-5 backdrop-blur-xl backdrop-saturate-150 sm:top-6 sm:min-h-14 sm:flex-nowrap">
        <Link to="/" className="flex min-h-12 items-center gap-2.5 text-base font-medium focus-visible:outline-2 focus-visible:outline-accent">
          <GridMark /> FileGrid
        </Link>
        <NavLinks />
        <div className="flex items-center gap-1">
          {access.chaos && (
            <button type="button" aria-expanded={panels.open === "chaos"} onClick={() => (panels.open === "chaos" ? panels.close() : panels.show("chaos"))}
              className="label whitespace-nowrap rounded-lg bg-bad-soft px-3 py-2 text-bad transition-colors hover:bg-bad/20 focus-visible:outline-2 focus-visible:outline-accent">Chaos</button>
          )}
          <UserMenu />
        </div>
      </motion.header>
      {/* Keyed by route: each screen fades up as it arrives. No exit animation, so navigation never waits. */}
      <motion.main key={path} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={SPRING.soft} className="pb-24">
        <Outlet />
      </motion.main>
      <Footer />
      {access.chaos && <ChaosDock />}
      {access.analyst && <><AnalystPanel /><AnalystLauncher /></>}
      <Toasts />
    </div>
  );
}
