import { useState } from "react";
import { truncateMiddle } from "../lib/format";

// Copy on click, per the receipt rule; the full value stays in the title for inspection.
export function HashText({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={value}
      className="rounded-md font-mono text-[13px] text-ink hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
    >
      {truncateMiddle(value)}
      <span className="ml-2 font-sans text-xs text-muted">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
