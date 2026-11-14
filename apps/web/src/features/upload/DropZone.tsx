import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "../../lib/format";

interface DropZoneProps {
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function DropZone({ file, onFile, disabled }: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && !disabled) onFile(dropped);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`w-full rounded-card border border-dashed px-6 py-14 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
        over ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-accent"
      }`}
    >
      <input ref={input} type="file" hidden data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <>
          <p className="font-display text-xl break-all">{file.name}</p>
          <p className="mt-1 text-sm text-muted tabular-nums">{formatBytes(file.size)} · click to choose another</p>
        </>
      ) : (
        <>
          <p className="font-display text-xl">Drop a file here</p>
          <p className="mt-1 text-sm text-muted">or click to browse. Nothing leaves your browser until you press Upload.</p>
        </>
      )}
    </button>
  );
}
