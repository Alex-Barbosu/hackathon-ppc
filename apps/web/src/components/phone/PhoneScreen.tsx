import type { ReactNode } from "react";

export interface PhoneRow { label: string; value: ReactNode }

interface PhoneScreenProps {
  eyebrow: string;
  title: ReactNode;
  status?: ReactNode;
  rows: PhoneRow[];
  footer?: ReactNode;
}

// The FileGrid UI as it appears inside the handset: same tokens, scaled to a phone.
export function PhoneScreen({ eyebrow, title, status, rows, footer }: PhoneScreenProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <GridMark size={16} />
        <span className="text-[13px] font-medium">FileGrid</span>
      </div>
      <p className="label mt-6 text-[10px] leading-4 text-faint">{eyebrow}</p>
      <p className="mt-2 font-display text-[26px] leading-[1.1] text-balance">{title}</p>
      {status && <div className="mt-3">{status}</div>}
      <dl className="mt-5 overflow-hidden rounded-xl border-[0.8px] border-line bg-panel">
        {rows.map((r, i) => (
          <div key={r.label} className={`flex items-center justify-between gap-2 px-3 py-2.5 text-[12px] ${i ? "border-t-[0.8px] border-line" : ""}`}>
            <dt className="text-faint">{r.label}</dt>
            <dd className="min-w-0 truncate text-right font-normal">{r.value}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-auto pb-6">{footer}</div>}
    </div>
  );
}

export function GridMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="6.5" height="6.5" rx="2" /><rect x="11.5" y="2" width="6.5" height="6.5" rx="2" />
      <rect x="2" y="11.5" width="6.5" height="6.5" rx="2" /><rect x="11.5" y="11.5" width="6.5" height="6.5" rx="3.25" />
    </svg>
  );
}
