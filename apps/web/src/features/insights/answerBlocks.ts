export type Inline = { text: string; bold: boolean };
export type Block = { kind: "p"; parts: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

// **bold** only: the analyst is told to use nothing else, and anything unrecognised stays literal text.
export function inline(text: string): Inline[] {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) =>
    t.startsWith("**") && t.endsWith("**") && t.length > 4 ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false });
}

/** Paragraphs, "- " bullets and "1. " lists from the analyst's plain text. Never HTML, so nothing can inject markup. */
export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  for (const line of src.replace(/\r/g, "").split("\n")) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks.at(-1);
    if (bullet || number) {
      const kind = bullet ? "ul" : "ol";
      const item = inline((bullet ?? number)![1]!);
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (line.trim() === "") {
      if (last && last.kind === "p") blocks.push({ kind: "p", parts: [] });
    } else if (last && last.kind === "p" && last.parts.length) {
      // The analyst puts one idea per line (verdict, next step, confidence), so a new line is a new paragraph.
      blocks.push({ kind: "p", parts: inline(line.trim()) });
    } else if (last && last.kind === "p") {
      last.parts.push(...inline(line.trim()));
    } else {
      blocks.push({ kind: "p", parts: inline(line.trim()) });
    }
  }
  return blocks.filter((b) => (b.kind === "p" ? b.parts.length > 0 : b.items.length > 0));
}
