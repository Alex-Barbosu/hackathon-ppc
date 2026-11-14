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
    <section aria-label="Storage health" className="overflow-hidden rounded-widget border-[0.8px] border-line bg-panel">
      <h3 className="label px-5 pt-4 pb-3.5 text-faint">Storage health</h3>
      <ul className="grid grid-cols-1 border-t-[0.8px] border-line sm:grid-cols-3 sm:divide-x-[0.8px] sm:divide-line">
        {isPending && [0, 1, 2].map((i) => <li key={i} className="h-16 m-4 animate-pulse rounded-lg bg-white/6" />)}
        {data?.map((s) => {
          const killed = stopped?.[s.storage] === "stopped";
          const t = !s.up || killed ? DOWN : s.circuitOpen ? HALF : UP;
          return (
            <motion.li layout key={s.storage} transition={{ type: "spring", stiffness: 260, damping: 30 }}
              className="border-t-[0.8px] border-line px-5 py-4 first:border-t-0 sm:border-t-0">
              <p className="text-[15px] font-normal">{LABEL[s.storage] ?? s.storage}</p>
              <p className={`mt-1 flex items-center gap-2 text-[13px] ${t.text}`}>
                <span className={`size-2 rounded-full transition-colors duration-500 ${t.dot}`} aria-hidden />
                {t.word}
                <span className="text-muted tabular-nums">{s.up && !killed && s.latencyMs != null ? `· ${s.latencyMs.toFixed(1)} ms` : ""}</span>
              </p>
            </motion.li>
          );
        })}
      </ul>
      {isError && <p className="border-t-[0.8px] border-line px-5 py-3 text-[13px] text-muted">Health check unreachable. Showing the last known state.</p>}
    </section>
  );
}
