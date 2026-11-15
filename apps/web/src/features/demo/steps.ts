import type { ChaosAction } from "../chaos/useChaos";

/** What a step does when its button is pressed. Pages are routes; panels open on the right edge. */
export type StepAction =
  | { kind: "go"; to: "/" | "/library" | "/operations" | "/lab" | "/insights" }
  | { kind: "chaos"; action: ChaosAction; then?: "/" | "/operations" }
  | { kind: "panel"; panel: "chaos" | "analyst"; draft?: string };

export interface DemoStep {
  title: string;
  /** What the audience should see; the presenter reads it, so it is short and concrete. */
  proof: string;
  /** The brief requirement this step proves, cited out loud. */
  proves: string;
  button: string;
  action: StepAction;
}

// The judges' definition of done (root CLAUDE.md §7), in the order that tells one story:
// it works, it is honest about integrity, then we break it and it holds.
export const DEMO_STEPS: readonly DemoStep[] = [
  { title: "Upload one file per category", proof: "Each upload returns a receipt with its SHA-256, storage and trace.", proves: "Store all four categories", button: "Open Upload", action: { kind: "go", to: "/" } },
  { title: "Download each file", proof: "Every download shows the SHA-256 matching the receipt.", proves: "Byte-identical, and provable", button: "Open Library", action: { kind: "go", to: "/library" } },
  { title: "Meters: none lost, none doubled", proof: "Acknowledged equals stored; duplicates are rejected by the idempotency key.", proves: "Retries never duplicate readings", button: "Open Operations", action: { kind: "go", to: "/operations" } },
  { title: "Kill S3", proof: "S3 turns red, StorageDown fires, the other categories keep working.", proves: "One storage down stops nothing else", button: "Stop S3", action: { kind: "chaos", action: { kind: "storage", storage: "s3", run: "stop" }, then: "/operations" } },
  { title: "Upload an outage record now", proof: "The receipt says PostgreSQL: the policy's fallback took over.", proves: "Confirmed files are never lost", button: "Open Upload", action: { kind: "go", to: "/" } },
  { title: "Bring S3 back", proof: "S3 is up again and the alert resolves on its own.", proves: "Recovery without manual action", button: "Start S3", action: { kind: "chaos", action: { kind: "storage", storage: "s3", run: "start" }, then: "/operations" } },
  { title: "Fire a 10x outage storm", proof: "Outage load climbs; meter p95 latency stays flat.", proves: "A spike in one category does not degrade others", button: "Fire storm", action: { kind: "chaos", action: { kind: "storm", category: "outage", multiplier: 10, durationSec: 60 }, then: "/operations" } },
  { title: "Degrade the field link", proof: "Start a drone video upload: it stalls, then resumes by itself.", proves: "Transfers survive lossy links", button: "Add 800 ms, 5% loss", action: { kind: "chaos", action: { kind: "network", body: { target: "client", latencyMs: 800, jitterMs: 200, lossPct: 5, bandwidthKbps: 0 } }, then: "/" } },
  { title: "Corrupt a stored file", proof: "Downloading it fails with INTEGRITY_FAILED and IntegrityFailure fires.", proves: "Corruption is detected on retrieval", button: "Open chaos", action: { kind: "panel", panel: "chaos" } },
  { title: "Ask Volta what happened", proof: "Volta answers from the live metrics, citing every number.", proves: "Statistics and interpretation", button: "Ask Volta", action: { kind: "panel", panel: "analyst", draft: "What happened on the grid and in FileGrid in the last 15 minutes?" } },
  { title: "Reset", proof: "Storages up, network clean, meters back to normal.", proves: "Back to a known state", button: "Reset chaos", action: { kind: "chaos", action: { kind: "reset" } } },
];
