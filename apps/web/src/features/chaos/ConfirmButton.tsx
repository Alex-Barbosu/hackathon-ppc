import { useEffect, useState } from "react";

// Destructive actions confirm in place (never a browser dialog); the arm state times out.
export function ConfirmButton({ label, confirmLabel, onConfirm, disabled }: {
  label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={`min-h-10 rounded-lg border-[0.8px] px-3.5 py-2 font-mono text-xs font-medium uppercase tracking-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        armed ? "border-bad bg-bad text-black" : "border-bad/60 text-bad hover:bg-bad-soft"
      }`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
