import type { Location } from "../lib/domain";

const LABEL: Record<Location, string> = { db: "Database", s3: "S3", ftp: "FTPS", spool: "Spooled" };

export function StorageBadge({ storage }: { storage: Location }) {
  const spooled = storage === "spool";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] ${
        spooled ? "bg-warn-soft text-warn" : "bg-accent-soft text-ink"
      }`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {LABEL[storage]}
    </span>
  );
}
