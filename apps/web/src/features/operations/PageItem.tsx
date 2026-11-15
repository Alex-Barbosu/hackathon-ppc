import { motion } from "framer-motion";
import { formatDateTime } from "../../lib/format";
import { Chip } from "../../components/ui";
import type { OnCallPage } from "./usePages";

const DELIVERY: Record<OnCallPage["delivery"], string> = {
  sent: "Pushed to phone", pending: "Push retrying", failed: "Push failed, see the app", off: "In app only",
};
const by = (who: string | undefined) => (who === "phone" ? "from the phone" : `by ${who ?? "someone"}`);

export function PageItem({ page, onAck, acking }: { page: OnCallPage; onAck: () => void; acking: boolean }) {
  const open = !page.resolvedAt;
  const acked = Boolean(page.ackedAt);
  const tone = !open ? "good" : acked ? "info" : "bad";
  return (
    <motion.li layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 260, damping: 30 }}
      className="border-t-[0.8px] border-line px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[15px] font-normal">{page.title}</span>
        <Chip tone={tone}>{!open ? "Resolved" : acked ? "Acknowledged" : "Waiting for on-call"}</Chip>
        <span className="text-[13px] text-muted tabular-nums">{formatDateTime(page.createdAt)}</span>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {page.onCall} · {DELIVERY[page.delivery]}
        {acked && page.ackedAt && <> · acknowledged {by(page.ackedBy)} at {formatDateTime(page.ackedAt)}</>}
      </p>
      <p className="mt-2 max-w-2xl whitespace-pre-line text-[15px] leading-6 text-white/85">{page.message}</p>
      {open && !acked && (
        <button type="button" onClick={onAck} disabled={acking}
          className="mt-3 inline-flex min-h-10 items-center rounded-lg border-[0.8px] border-line-strong px-4 font-mono text-xs uppercase tracking-label text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40">
          {acking ? "Acknowledging" : "Acknowledge"}
        </button>
      )}
    </motion.li>
  );
}
