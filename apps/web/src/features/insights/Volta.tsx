import { motion } from "framer-motion";

/** The analyst has a name and a face so a question feels asked of someone: Volta, after the unit on every meter. */
export const ANALYST_NAME = "Volta";

// A small waveform mark: three bars that breathe while Volta is working, still otherwise.
export function VoltaMark({ busy = false, size = 28 }: { busy?: boolean; size?: number }) {
  const bars = [0.45, 1, 0.65];
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-white text-black" style={{ width: size, height: size }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 14 14">
        {bars.map((h, i) => (
          <motion.rect key={i} x={1.5 + i * 4.5} width={2.2} rx={1.1} fill="currentColor"
            initial={false} animate={busy ? { height: [14 * h, 4, 14 * h], y: [7 - 7 * h, 5, 7 - 7 * h] } : { height: 14 * h, y: 7 - 7 * h }}
            transition={busy ? { duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" } : { duration: 0.3 }} />
        ))}
      </svg>
    </span>
  );
}

export function greeting(role: string | undefined, hour = new Date().getHours()): string {
  const part = hour < 5 ? "Late shift" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}${role ? `, ${role}` : ""}. I'm ${ANALYST_NAME}. I watch the storages, the meters and the outage records, and I answer from live numbers.`;
}
