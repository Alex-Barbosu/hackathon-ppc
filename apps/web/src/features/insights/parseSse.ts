import type { AnalystEvent } from "../../lib/domain.ts";

/**
 * Turns a streamed response body into analyst events. Chunks can split an event anywhere, so the
 * parser keeps what it has not finished. A line that is not valid JSON is skipped, not fatal.
 */
export function createSseParser(): (chunk: string) => AnalystEvent[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    return parts.flatMap((block) => {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) return [];
      try {
        const e = JSON.parse(data) as AnalystEvent;
        return typeof e.type === "string" ? [e] : [];
      } catch {
        return [];
      }
    });
  };
}
