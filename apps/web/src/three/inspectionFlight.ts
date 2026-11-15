import { CatmullRomCurve3, ConeGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Vector3 } from "three";
import type { Anchor, Finding } from "../features/inspection/findings";
import { ATTACH } from "./pylon";
import { hill, ROUTE, towerMatrix } from "./line";

const PATH = new CatmullRomCurve3(ROUTE);
const U_START = 0.15, U_END = 6.4;

// Unit vector across the line at route position u (in tower units): the side the +x arms point to.
function across(u: number): Vector3 {
  const t = PATH.getTangent(Math.min(Math.max(u / (ROUTE.length - 1), 0), 1));
  return new Vector3(t.z, 0, -t.x).normalize();
}
const ground = (u: number) => PATH.getPoint(Math.min(Math.max(u / (ROUTE.length - 1), 0), 1));

/**
 * The drone's pose at a moment of the flight. A pure function of time, so the detection timeline can be
 * computed up front and scrubbing lands on exactly the frame a viewer saw before.
 */
export function dronePose(sec: number, duration: number, camera: PerspectiveCamera) {
  const k = Math.min(Math.max(sec / duration, 0), 1);
  const u = U_START + (U_END - U_START) * (k * 0.92 + 0.08 * (1 - Math.cos(k * Math.PI)) / 2);
  const p = ground(u).add(across(u).multiplyScalar(24));
  // Flies about 36 m above ground with a little hand-flown drift, looking ahead and down at the conductors.
  camera.position.set(p.x + Math.sin(sec * 0.7) * 0.4, hill(p.x, p.z) + 36 + Math.sin(sec * 0.43) * 0.6, p.z);
  const ahead = ground(u + 1.05).add(across(u + 1.05).multiplyScalar(3));
  camera.lookAt(ahead.x, hill(ahead.x, ahead.z) + 14, ahead.z);
}

const sagAt = (a: Vector3, b: Vector3, t: number) => a.distanceTo(b) * 0.034 * 4 * t * (1 - t);

/** World position of a finding's anchor, resolved against the same towers and spans the scene draws. */
export function anchorPoint(a: Anchor): Vector3 {
  if (a.at === "attach") return new Vector3(...ATTACH[a.attach]!).applyMatrix4(towerMatrix(a.tower)).add(new Vector3(0, 0.75, 0));
  if (a.at === "span") {
    const from = new Vector3(...ATTACH[a.attach]!).applyMatrix4(towerMatrix(a.tower));
    const to = new Vector3(...ATTACH[a.attach]!).applyMatrix4(towerMatrix(a.tower + 1));
    const p = from.clone().lerp(to, a.t);
    return p.setY(p.y - sagAt(from, to, a.t));
  }
  const u = a.tower + a.t;
  const p = ground(u).add(across(u).multiplyScalar(a.side));
  return p.setY(hill(p.x, p.z) + a.height);
}

// Deterministic scatter so every viewer sees the same trees in the same places.
const rand = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

/**
 * Trees: woodland kept out of the cleared corridor, plus the clumps the findings point at. Without the
 * clumps a box labelled "vegetation" would sit over bare ground.
 */
export function trees(findings: Finding[], color: string): Group {
  const spots: Array<[Vector3, number]> = [];
  for (let i = 0; i < 170; i++) {
    const u = rand(i) * 7.5, side = (rand(i + 500) > 0.5 ? 1 : -1) * (34 + rand(i + 900) * 150);
    const p = ground(u).add(across(u).multiplyScalar(side));
    spots.push([p, 9 + rand(i + 1300) * 9]);
  }
  for (const f of findings) {
    if (f.anchor.at !== "beside") continue;
    const c = anchorPoint(f.anchor);
    const top = f.anchor.height + f.anchor.radius * 0.7;
    for (let j = 0; j < 9; j++) {
      const p = c.clone().add(new Vector3((rand(j + c.x) - 0.5) * f.anchor.radius * 1.6, 0, (rand(j * 3 + c.z) - 0.5) * f.anchor.radius * 1.6));
      spots.push([p, top * (0.7 + rand(j + 77) * 0.3)]);
    }
  }
  const cone = new ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const mesh = new InstancedMesh(cone, new MeshBasicMaterial({ color }), spots.length);
  spots.forEach(([p, h], i) => mesh.setMatrixAt(i, new Matrix4().makeScale(h * 0.2, h, h * 0.2).setPosition(p.x, hill(p.x, p.z) - 0.8, p.z)));
  return new Group().add(mesh);
}
