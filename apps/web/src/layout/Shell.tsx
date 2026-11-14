import { Link, Outlet } from "@tanstack/react-router";

const NAV = [
  { to: "/", label: "Upload" },
  { to: "/library", label: "Library" },
  { to: "/operations", label: "Operations" },
  { to: "/chaos", label: "Chaos" },
] as const;

export function Shell() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
      <header className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display text-xl font-semibold">FileGrid</p>
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
