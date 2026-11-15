import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, Fog, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, TubeGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ATTACH, pylonGeometry } from "./pylon";
import type { Mood } from "./sky";

// The line runs away from the camera with a slight bend, so the towers overlap in perspective.
export const ROUTE = Array.from({ length: 9 }, (_, i) => new Vector3(9 - i * 2.2 - i * i * 0.55, 0, 6 - i * 64));
export const hill = (x: number, z: number) => Math.sin(x * 0.021 + 1.3) * 2.6 + Math.sin(z * 0.017) * 3.2 + Math.sin((x + z) * 0.006) * 5;

export function towerMatrix(i: number): Matrix4 {
  const p = ROUTE[i]!;
  const next = ROUTE[Math.min(i + 1, ROUTE.length - 1)]!, prev = ROUTE[Math.max(i - 1, 0)]!;
  // Arms sit across the line, so the tower faces along the route's tangent.
  const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
  return new Matrix4().makeRotationY(yaw).setPosition(p.x, hill(p.x, p.z) - 0.6, p.z);
}

// A span sags by about 3% of its length: a parabola is indistinguishable from a catenary here.
function span(a: Vector3, b: Vector3, r: number): BufferGeometry {
  const sag = a.distanceTo(b) * 0.034;
  const pts = Array.from({ length: 13 }, (_, k) => { const t = k / 12; return a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)); });
  return new TubeGeometry(new CatmullRomCurve3(pts), 24, r, 4, false);
}

function cables(mats: Matrix4[]): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < mats.length - 1; i++) for (const [k, at] of ATTACH.entries()) {
    const a = new Vector3(...at).applyMatrix4(mats[i]!), b = new Vector3(...at).applyMatrix4(mats[i + 1]!);
    parts.push(span(a, b, k === ATTACH.length - 1 ? 0.035 : 0.055));
  }
  // The line also arrives from behind the camera, so wires cross the top of the frame.
  for (const at of ATTACH) parts.push(span(new Vector3(...at).applyMatrix4(mats[0]!), new Vector3(at[0] + 22, at[1] + 3, 80), 0.055));
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// The land stays a silhouette: scene fog would wash it into the sky colour, so it carries its own
// gentler haze, baked per vertex by distance from the camera's side of the scene.
function ground(mood: Mood): Mesh {
  const g = new PlaneGeometry(1800, 1800, 120, 120).rotateX(-Math.PI / 2);
  const pos = g.attributes.position!;
  const near = new Color(mood.ground), far = new Color(mood.ground).lerp(new Color(mood.fog), 0.42);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, hill(x, z) - 0.8);
    const c = near.clone().lerp(far, Math.min(1, Math.hypot(x, z - 40) / 700) ** 1.4);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return new Mesh(g, new MeshBasicMaterial({ vertexColors: true, fog: false }));
}

/** Towers, conductors and the dark land under them. Unlit on purpose: against a bright sky steel is a silhouette. */
export function powerLine(mood: Mood): { group: Group; fog: Fog } {
  const group = new Group();
  const steel = new MeshBasicMaterial({ color: mood.steel });
  const mats = ROUTE.map((_, i) => towerMatrix(i));
  const towers = new InstancedMesh(pylonGeometry(), steel, mats.length);
  mats.forEach((m, i) => towers.setMatrixAt(i, m));
  group.add(towers, new Mesh(cables(mats), steel), ground(mood));
  // Fog in the horizon colour is what gives the far towers their distance.
  return { group, fog: new Fog(new Color(mood.fog), 90, 720) };
}
