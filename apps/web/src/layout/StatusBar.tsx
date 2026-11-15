import { useAccess } from "../state/useAccess";
import { useStoragesHealth } from "../features/operations/useStoragesHealth";
import { GRAFANA_HOME } from "../lib/grafana";

const NAMES: Record<string, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS" };
const Kbd = ({ children }: { children: string }) => <kbd className="rounded border-[0.8px] border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;

// The strip an operator glances at from any screen: are the three storages up, and how to move fast.
export function StatusBar() {
  const { pages } = useAccess();
  const { data, isError } = useStoragesHealth();
  const storages = data ?? [];
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t-[0.8px] border-line py-4 text-[12px] text-faint">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {storages.map((s) => (
          <span key={s.storage} className="flex items-center gap-1.5">
            <span aria-hidden className={`size-1.5 rounded-full ${s.up ? "bg-good" : "bg-bad"}`} />
            {NAMES[s.storage] ?? s.storage} <span className={s.up ? "" : "text-bad"}>{s.up ? "up" : "down"}</span>
          </span>
        ))}
        {isError && !data && <span className="text-warn">Storage health not reporting</span>}
        <span className="max-md:hidden">Storages are reachable only through FileGrid · every file carries a SHA-256 receipt</span>
      </div>
      <div className="flex items-center gap-4">
        {pages.includes("/operations") && <a href={GRAFANA_HOME} target="_blank" rel="noreferrer" className="hover:text-ink">Grafana ↗</a>}
        <span className="flex items-center gap-1.5 max-sm:hidden"><Kbd>Ctrl</Kbd><Kbd>K</Kbd> commands</span>
      </div>
    </footer>
  );
}
