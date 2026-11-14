import { motion } from "framer-motion";
import { HashText } from "../../components/HashText";
import { StorageBadge } from "../../components/StorageBadge";
import type { FileReceipt } from "../../lib/domain";
import { formatBytes, formatDateTime } from "../../lib/format";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-line py-3 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-sm tabular-nums">{children}</dd>
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
      className="rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Stored and verified</h2>
        <StorageBadge storage={receipt.storage} />
      </div>
      <dl className="mt-4">
        <Row label="SHA-256"><HashText value={receipt.sha256} /></Row>
        <Row label="Size">{formatBytes(receipt.sizeBytes)}</Row>
        <Row label="Stored">{formatDateTime(receipt.storedAt)}</Row>
        <Row label="Encrypted">{receipt.encrypted ? "Yes, AES-256-GCM" : "No"}</Row>
        <Row label="Trace ID"><HashText value={receipt.traceId} /></Row>
      </dl>
    </motion.section>
  );
}
