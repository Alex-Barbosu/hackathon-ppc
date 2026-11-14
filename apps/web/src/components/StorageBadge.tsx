import type { Location } from "../lib/domain";

const LABEL: Record<Location, string> = { db: "Database", s3: "S3", ftp: "FTPS", spool: "Spooled" };

export function StorageBadge({ storage }: { storage: Location }) {
  const spooled = storage === "spool";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        spooled ? "bg-warn/10 text-warn" : "bg-accent-soft text-accent"
      }`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {LABEL[storage]}
    </span>
  );
}
