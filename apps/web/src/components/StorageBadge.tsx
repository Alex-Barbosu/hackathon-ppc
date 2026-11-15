import type { Location } from "../lib/domain";

const LABEL: Record<Location, string> = { db: "Database", s3: "S3", ftp: "FTPS", spool: "Spooled" };

export function StorageBadge({ storage }: { storage: Location }) {
  const spooled = storage === "spool";
  return (
    <span className={`text-[13px] ${spooled ? "text-warn" : "text-ink"}`}>
      {LABEL[storage]}
    </span>
  );
}
