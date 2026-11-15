import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { WIDGET } from "../../components/ui";
import type { UploadCategory } from "../../lib/domain";

const STORE: Record<string, string> = { db: "PostgreSQL", s3: "S3", ftp: "FTPS", spool: "Local spool" };
const VIA: Record<UploadCategory, string> = { outage: "Multipart POST", document: "Multipart POST", video: "tus 1.0, resumable" };

// What an operator wants beside the form: where this category will go right now, read from the live policy.
export function UploadFacts({ category }: { category: UploadCategory }) {
  const { data } = useQuery({ queryKey: ["policy", "full"], staleTime: 30_000, queryFn: async () => (await api.GET("/api/v1/policy")).data });
  const p = data?.categories[category];
  const rows: Array<[string, string]> = p
    ? [["Primary", STORE[p.primary] ?? p.primary], ["Fallback", STORE[p.fallback] ?? p.fallback], ["Encryption", p.encrypt ? "AES-256-GCM at rest" : "None"],
       ["Size limit", p.maxSizeMb >= 1000 ? `${p.maxSizeMb / 1000} GB` : `${p.maxSizeMb} MB`], ["Transfer", VIA[category]], ["Priority", `${p.priority}, ${p.workers} workers`],
       ...(p.audit ? [["Audit", "Hash-chained log"] as [string, string]] : [])]
    : [];
  return (
    <aside aria-label="Routing policy" className={`${WIDGET} lg:sticky lg:top-28`}>
      <p className="label border-b-[0.8px] border-line px-5 py-3 text-faint">Routing · policy v{data?.version ?? "–"}</p>
      {p ? (
        <dl className="divide-y divide-line px-5 text-sm">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
        </dl>
      ) : <div className="m-5 h-40 animate-pulse rounded-lg bg-white/5" />}
      <p className="border-t-[0.8px] border-line px-5 py-3 text-[12px] text-faint">Integrity: SHA-256 on arrival, verified again on every download.</p>
    </aside>
  );
}
