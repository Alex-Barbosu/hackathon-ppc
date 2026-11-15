import { AnimatePresence } from "framer-motion";
import { useSession } from "../../state/session";
import { PageItem } from "./PageItem";
import { useAckPage, usePages } from "./usePages";

const RECENT_MS = 60 * 60_000;

/** Who was woken up and whether they answered. Admin sees platform and grid pages, dispatch the grid only. */
export function PagerPanel() {
  const role = useSession((s) => s.session?.role);
  const allowed = role === "admin" || role === "dispatch";
  const { data, isError, isPending } = usePages(allowed);
  const ack = useAckPage();
  if (!allowed) return null;
  const now = Date.now();
  // Open pages always; closed ones for an hour, so the demo's story stays on screen after it resolves.
  const shown = (data ?? []).filter((p) => !p.resolvedAt || now - new Date(p.resolvedAt).getTime() < RECENT_MS).slice(0, 6);
  const waiting = shown.filter((p) => !p.resolvedAt && !p.ackedAt).length;
  return (
    <section aria-label="Pager" className="overflow-hidden rounded-widget border-[0.8px] border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3.5">
        <h3 className="label text-faint">Pager · {role === "admin" ? "platform and grid on-call" : "dispatch on-call"}</h3>
        {waiting > 0 && <span className="text-[13px] text-bad tabular-nums">{waiting} waiting for an answer</span>}
      </div>
      <ul className="border-t-[0.8px] border-line">
        {isPending && <li className="m-4 h-20 animate-pulse rounded-lg bg-white/6" />}
        {!isPending && !isError && shown.length === 0 && (
          <li className="px-5 py-4 text-[13px] text-muted">
            Nobody has been paged in the last hour. A storage down for a minute, a corrupted file or five outage records from one county in 15 minutes will page the on-call here and on their phone.
          </li>
        )}
        <AnimatePresence initial={false}>
          {shown.map((p) => <PageItem key={p.id} page={p} onAck={() => ack.mutate(p.id)} acking={ack.isPending && ack.variables === p.id} />)}
        </AnimatePresence>
      </ul>
      {isError && <p className="border-t-[0.8px] border-line px-5 py-3 text-[13px] text-muted">Pages could not be read. Phone pushes are not affected.</p>}
      {ack.isError && <p className="border-t-[0.8px] border-line px-5 py-3 text-[13px] text-bad">The acknowledgement did not save. Try again.</p>}
    </section>
  );
}
