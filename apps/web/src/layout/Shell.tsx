import { useEffect } from "react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useSession } from "../state/session";
import { UserMenu } from "./UserMenu";

const NAV = [
  { to: "/", label: "Upload" },
  { to: "/library", label: "Library" },
  { to: "/operations", label: "Operations" },
  { to: "/chaos", label: "Chaos" },
] as const;

export function Shell() {
  const signedIn = useSession((s) => s.session !== null);
  const navigate = useNavigate();
  // The API signs us out on a 401; send the user to Login instead of leaving a dead page.
  useEffect(() => {
    if (!signedIn) void navigate({ to: "/login" });
  }, [signedIn, navigate]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-4 sm:contents">
          <p className="font-display text-xl font-semibold">FileGrid</p>
          <div className="sm:order-3"><UserMenu /></div>
        </div>
        <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="rounded-xl px-3.5 py-2 text-sm text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              activeProps={{ className: "bg-accent-soft text-accent font-medium" }}
              activeOptions={{ exact: true }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="pt-10 sm:pt-14"><Outlet /></main>
    </div>
  );
}
