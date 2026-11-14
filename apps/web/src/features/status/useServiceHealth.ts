import { useEffect, useState } from "react";

export type HealthState = "checking" | "up" | "down";

// Polls a health URL so the base page proves the gateway routes to every service.
export function useServiceHealth(url: string, intervalMs = 5000): HealthState {
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!cancelled) setState(res.ok ? "up" : "down");
      } catch {
        if (!cancelled) setState("down");
      }
    };
    void check();
    const id = setInterval(() => void check(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, intervalMs]);

  return state;
}
