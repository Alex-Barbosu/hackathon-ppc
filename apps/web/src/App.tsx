import { StatusBoard } from "./features/status/StatusBoard";

// Base shell. Zone C replaces this with the router (Upload, Library, Operations,
// Chaos, Storage Lab, Insights, Policy).
export function App() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-sm font-medium tracking-wide text-accent uppercase">Rețele Electrice · FileGrid</p>
      <h1 className="mt-3 font-display text-5xl leading-tight font-semibold">
        One door for every file the grid sends home.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted">
        Base scaffold is running. Each card below is a live health check through the gateway.
      </p>
      <StatusBoard />
    </main>
  );
}
