import { BufferGeometry, CylinderGeometry, Matrix4, Quaternion, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type P = [number, number, number];
const UP = new Vector3(0, 1, 0);

// One steel member between two points. Four radial segments read as an angle section and keep
// a whole tower under 8k triangles.
function member(a: P, b: P, r: number): BufferGeometry {
  const from = new Vector3(...a);
  const to = new Vector3(...b);
  const dir = to.clone().sub(from);
  const g = new CylinderGeometry(r, r, dir.length(), 4, 1, true);
  const q = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  g.applyMatrix4(new Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  return g;
}

// Half-width of the tower body at a height: wide feet, a waist at 22 m, then a straight head.
const half = (y: number) => (y < 22 ? 3.4 - (2.5 * y) / 22 : 0.9);
const CORNERS: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
const corner = (i: number, y: number): P => { const [sx, sz] = CORNERS[i % 4]!; return [sx * half(y), y, sz * half(y)]; };

/** Arm heights and reaches of a double-circuit 110 kV lattice tower; cables hang from the tips. */
export const ARMS: Array<{ y: number; reach: number }> = [{ y: 21, reach: 6.2 }, { y: 25.5, reach: 5.2 }, { y: 30, reach: 4.3 }];
export const PEAK = 34;

function body(parts: BufferGeometry[]) {
  const levels = [0, 4.5, 8.5, 12, 15, 17.6, 19.8, 22, 24, 26, 28, 30, 31.5];
  for (let l = 0; l < levels.length - 1; l++) {
    const y0 = levels[l]!, y1 = levels[l + 1]!;
    for (let i = 0; i < 4; i++) {
      parts.push(member(corner(i, y0), corner(i, y1), 0.15));          // leg
      parts.push(member(corner(i, y1), corner(i + 1, y1), 0.07));      // ring
      parts.push(member(corner(i, y0), corner(i + 1, y1), 0.06));     // X bracing, both diagonals
      parts.push(member(corner(i + 1, y0), corner(i, y1), 0.06));
    }
  }
  for (let i = 0; i < 4; i++) parts.push(member(corner(i, 31.5), [0, PEAK, 0], 0.08));
}

function arms(parts: BufferGeometry[]) {
  for (const { y, reach } of ARMS) for (const side of [1, -1]) {
    const tip: P = [side * reach, y, 0];
    const w = half(y);
    for (const sz of [1, -1]) {
      parts.push(member([side * w, y, sz * w], tip, 0.07));                 // lower chord
      parts.push(member([side * w, y + 1.8, sz * w], tip, 0.055));          // upper tie
      const mid = (side * (w + reach)) / 2;
      parts.push(member([mid, y, (sz * w) / 2], [side * w, y + 1.8, sz * w], 0.04));
    }
    parts.push(member([(side * (w + reach)) / 2, y, w / 2], [(side * (w + reach)) / 2, y, -w / 2], 0.04));
    parts.push(member(tip, [side * reach, y - 1.5, 0], 0.07));              // insulator string
  }
}

/** A lattice transmission tower, 34 m tall, feet on y = 0, arms along x. */
export function pylonGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  body(parts);
  arms(parts);
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/** Where the seven conductors attach, in the tower's own frame: six phases and the earth wire. */
export const ATTACH: P[] = [...ARMS.flatMap(({ y, reach }): P[] => [[reach, y - 1.5, 0], [-reach, y - 1.5, 0]]), [0, PEAK, 0]];
