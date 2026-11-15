import { useEffect } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { GridMark } from "../components/phone/PhoneScreen";
import { useSession } from "../state/session";
import { Footer } from "./Footer";
import { NAV } from "./nav";
import { useAccess } from "../state/useAccess";
import { usePanels } from "../state/panels";
import { ChaosDock } from "../features/chaos/ChaosDock";
import { Toasts } from "../features/chaos/Toasts";
import { AnalystLauncher } from "../features/insights/AnalystLauncher";
import { AnalystPanel } from "../features/insights/AnalystPanel";
import { UserMenu } from "./UserMenu";


const ITEM =
  "label whitespace-nowrap rounded-lg bg-surface px-3 py-2 text-ink transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent";

export function Shell() {
  const signedIn = useSession((s) => s.session !== null);
  const navigate = useNavigate();
  const access = useAccess();
  const panels = usePanels();
  // The API signs us out on a 401; send the user to Login instead of leaving a dead page.
  useEffect(() => {
    if (!signedIn) void navigate({ to: "/login" });
  }, [signedIn, navigate]);

  return (
    <div className="mx-auto max-w-[1424px] px-4 pt-4 sm:px-6 sm:pt-6">
      {/* Origin's floating bar: 56px, 12px radius, 4% white, items as quiet tiles. */}
      <header className="sticky top-4 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border-[0.8px] border-line bg-[#0b0b0b] py-1 pr-1 pl-5 sm:top-6 sm:min-h-14 sm:flex-nowrap">
        <Link to="/" className="flex min-h-12 items-center gap-2.5 text-base font-medium focus-visible:outline-2 focus-visible:outline-accent">
          <GridMark /> FileGrid
        </Link>
        <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1.5 overflow-x-auto px-1 pb-1 sm:order-none sm:w-auto sm:pb-0">
          {NAV.filter((n) => access.pages.includes(n.to)).map((n) => (
            <Link key={n.to} to={n.to} className={ITEM} activeProps={{ className: "!bg-accent-soft", "aria-current": "page" }} activeOptions={{ exact: true }}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          {access.chaos && (
            <button type="button" aria-expanded={panels.open === "chaos"} onClick={() => (panels.open === "chaos" ? panels.close() : panels.show("chaos"))}
              className={`${ITEM} !bg-bad-soft !text-bad hover:!bg-bad/20`}>Chaos</button>
          )}
          <UserMenu />
        </div>
      </header>
      <main className="pb-24"><Outlet /></main>
      <Footer />
      {access.chaos && <ChaosDock />}
      {access.analyst && <><AnalystPanel /><AnalystLauncher /></>}
      <Toasts />
    </div>
  );
}
