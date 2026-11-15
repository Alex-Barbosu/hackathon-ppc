import { traceUrl } from "../../lib/grafana";
import { motion } from "framer-motion";
import { HashText } from "../../components/HashText";
import { StorageBadge } from "../../components/StorageBadge";
import type { FileReceipt } from "../../lib/domain";
import { formatBytes, formatDateTime } from "../../lib/format";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t-[0.8px] border-line py-2.5">
      <dt className="caption text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm tabular-nums">{children}</dd>
    </div>
  );
}

export function ReceiptCard({ receipt }: { receipt: FileReceipt }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      aria-label="Receipt"
      className="rounded-widget border-[0.8px] border-line bg-panel p-5 lg:sticky lg:top-28"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-normal">Stored and verified</h2>
        <StorageBadge storage={receipt.storage} />
      </div>
      <dl className="mt-4">
        <Row label="SHA-256"><HashText value={receipt.sha256} /></Row>
        <Row label="Size">{formatBytes(receipt.sizeBytes)}</Row>
        <Row label="Stored">{formatDateTime(receipt.storedAt)}</Row>
        <Row label="Encrypted">{receipt.encrypted ? "Yes, AES-256-GCM" : "No"}</Row>
        <Row label="Trace ID">{receipt.traceId ? <a href={traceUrl(receipt.traceId)} target="_blank" rel="noreferrer" className="text-info hover:underline">Open trace ↗</a> : "–"}</Row>
      </dl>
    </motion.section>
  );
}
