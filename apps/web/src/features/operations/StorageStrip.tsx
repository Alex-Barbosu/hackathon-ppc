import { motion } from "framer-motion";
import { useChaosState } from "../chaos/useChaos";
import { useStoragesHealth } from "./useStoragesHealth";

const LABEL: Record<string, string> = { db: "PostgreSQL", s3: "S3 (SeaweedFS)", ftp: "FTPS" };
type Tone = { word: string; dot: string; text: string };
const UP: Tone = { word: "Up", dot: "bg-good", text: "text-good" };
const HALF: Tone = { word: "Circuit open", dot: "bg-warn", text: "text-warn" };
const DOWN: Tone = { word: "Down", dot: "bg-bad", text: "text-bad" };

export function StorageStrip() {
  const { data, isError, isPending } = useStoragesHealth();
  // The API probe can take several seconds to give up on a dead storage; the container state
  // from chaos-control is already known, so admins see the change as soon as the action returns.
  const stopped = useChaosState().data?.storages;
  return (
    <section aria-label="Storage health" className="rounded-card border border-line bg-surface p-6">
      <h3 className="font-display text-lg">Storage health</h3>
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {isPending && [0, 1, 2].map((i) => <li key={i} className="h-16 animate-pulse rounded-xl bg-canvas" />)}
        {data?.map((s) => {
          const killed = stopped?.[s.storage] === "stopped";
          const t = !s.up || killed ? DOWN : s.circuitOpen ? HALF : UP;
          return (
            <motion.li layout key={s.storage} transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="rounded-xl border border-line px-4 py-3">
              <p className="text-sm font-medium">{LABEL[s.storage] ?? s.storage}</p>
              <p className={`mt-1 flex items-center gap-2 text-[13px] ${t.text}`}>
                <span className={`size-2 rounded-full transition-colors duration-500 ${t.dot}`} aria-hidden />
                {t.word}
                <span className="text-muted tabular-nums">{s.up && !killed && s.latencyMs != null ? `· ${s.latencyMs.toFixed(1)} ms` : ""}</span>
              </p>
            </motion.li>
          );
        })}
      </ul>
      {isError && <p className="mt-3 text-[13px] text-muted">Health check unreachable. Showing the last known state.</p>}
    </section>
  );
}
