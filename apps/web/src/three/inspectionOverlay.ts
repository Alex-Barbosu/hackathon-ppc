import { KIND_LABEL, type Finding } from "../features/inspection/findings";

export interface Box { x: number; y: number; r: number; dist: number }

const TONE: Record<Finding["severity"], string> = { high: "#f87171", medium: "#fbbf24", review: "rgba(255,255,255,0.85)" };

// A real detector's boxes wobble a few pixels and its scores drift frame to frame; perfectly still
// boxes read as stickers. The wobble is deterministic so a paused frame stays put.
const wobble = (sec: number, seed: number) => Math.sin(sec * 9.1 + seed) * 0.6 + Math.sin(sec * 23.7 + seed * 2) * 0.4;

/** Corner-bracket box with a label strip: kind, confidence, distance. */
export function drawBox(ctx: CanvasRenderingContext2D, f: Finding, b: Box, sec: number, selected: boolean) {
  const seed = f.id.charCodeAt(3);
  const half = b.r * (f.kind === "sag" ? 1.5 : 1.05);
  const halfH = b.r * (f.kind === "sag" ? 0.6 : 1);
  const x = b.x - half + wobble(sec, seed) * 2, y = b.y - halfH + wobble(sec, seed + 4) * 2;
  const w = half * 2 + wobble(sec, seed + 8) * 2, h = halfH * 2;
  const c = Math.min(14, w / 4, h / 4);
  ctx.strokeStyle = TONE[f.severity];
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    ctx.moveTo(cx + dx * c, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * c);
  }
  ctx.stroke();
  ctx.globalAlpha = selected ? 0.9 : 0.35;
  ctx.lineWidth = 0.75;
  ctx.strokeRect(x, y, w, h);

  const score = Math.min(0.99, f.confidence + wobble(sec * 0.5, seed) * 0.015).toFixed(2);
  const text = `${KIND_LABEL[f.kind].toUpperCase()}  ${score}  ${Math.round(b.dist)} m`;
  ctx.font = "500 10.5px 'Roboto Mono', ui-monospace, monospace";
  const tw = ctx.measureText(text).width + 12;
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = "#050505";
  ctx.fillRect(x, y - 20, tw, 18);
  ctx.globalAlpha = 1;
  ctx.fillStyle = TONE[f.severity];
  ctx.fillText(text, x + 6, y - 7);
}
