import { Color, DirectionalLight, Fog, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3, WebGLRenderer } from "three";
import { hill, powerLine } from "../src/three/line";
import { MOODS, skyDome } from "../src/three/sky";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);

// The same scene the app animates, frozen at a chosen second, with or without the line.
function sky(mood: "day" | "dusk", line: boolean, w: number, h: number, t: number) {
  renderer.setSize(w, h, false);
  const scene = new Scene();
  const dome = skyDome(MOODS[mood]);
  dome.material.uniforms.uTime!.value = t;
  scene.add(dome);
  const camera = new PerspectiveCamera(line ? 46 : 62, w / h, 0.5, 2000);
  if (line) {
    const { group, fog } = powerLine(MOODS[mood]);
    scene.fog = fog; scene.add(group);
    camera.position.set(-13, hill(-13, 44) + 1.2, 44); camera.lookAt(3, 19, -30);
  } else { camera.position.set(0, 0, 0); camera.lookAt(0.6, 0.9, 1); }
  renderer.render(scene, camera);
}

// Deterministic pseudo-random numbers, so every run writes the same picture.
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function sunlit(scene: Scene, dir: [number, number, number], sky: string, groundCol: string, extent: number, ambient = 0.5) {
  const sun = new DirectionalLight("#fff3d6", 3.2);
  sun.position.set(...dir).multiplyScalar(200);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 800 });
  sun.shadow.bias = -0.0015;
  scene.add(sun, new HemisphereLight(sky, groundCol, ambient));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
}

// Forest from a drone: twelve thousand tree crowns as lumpy spheres, low sun, real shadows between them.
function forest(w: number, h: number) {
  renderer.setSize(w, h, false);
  seed = 11;
  const scene = new Scene();
  scene.background = new Color("#030a05");
  sunlit(scene, [-0.8, 0.42, 0.3], "#6f9a7a", "#010302", 150, 0.22);
  const geo = new IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position!;
  // Lumps make each crown read as foliage instead of a ball.
  for (let i = 0; i < pos.count; i++) { const v = new Vector3().fromBufferAttribute(pos, i); const k = 1 + 0.16 * Math.sin(v.x * 7 + v.y * 5) * Math.cos(v.z * 6 + v.y * 3) + 0.08 * Math.sin(v.x * 17) * Math.sin(v.z * 15); pos.setXYZ(i, v.x * k, v.y * k, v.z * k); }
  geo.computeVertexNormals();
  const count = 12000;
  const trees = new InstancedMesh(geo, new MeshStandardMaterial({ roughness: 0.95 }), count);
  trees.castShadow = trees.receiveShadow = true;
  const m = new Matrix4(), q = new Quaternion(), c = new Color();
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * 300, z = (rnd() - 0.5) * 200;
    const patch = 0.5 + 0.5 * Math.sin(x * 0.045 + 1) * Math.cos(z * 0.06);
    const r = 2 + rnd() * 2.2 + patch * 1.4;
    q.setFromAxisAngle(new Vector3(rnd(), 1, rnd()).normalize(), rnd() * 6.3);
    m.compose(new Vector3(x, r * 0.5 + rnd() * 2.5 + patch * 3, z), q, new Vector3(r, r * (0.75 + rnd() * 0.5), r));
    trees.setMatrixAt(i, m);
    trees.setColorAt(i, c.setHSL(0.29 + rnd() * 0.08, 0.5 + rnd() * 0.2, 0.05 + rnd() * 0.07 + patch * 0.03));
  }
  scene.add(trees);
  const camera = new PerspectiveCamera(30, w / h, 1, 1000);
  camera.position.set(0, 300, 26); camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  renderer.shadowMap.enabled = false;
}

// Rolling pasture in evening sun: a smooth height field, lit low from the left so every fold shows.
function field(w: number, h: number) {
  renderer.setSize(w, h, false);
  const scene = new Scene();
  scene.background = new Color("#163a12");
  scene.fog = new Fog("#163a12", 500, 1500);
  sunlit(scene, [-0.9, 0.2, 0.1], "#8fc070", "#020a02", 500, 0.16);
  const rise = (x: number, z: number) => Math.sin(x * 0.012 + z * 0.004) * 30 + Math.sin(z * 0.017 - x * 0.006 + 2) * 22 + Math.sin(x * 0.031 + z * 0.023) * 9 + Math.sin((x - z) * 0.05) * 1.6;
  const geo = new PlaneGeometry(1600, 1600, 400, 400).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  const colors = new Float32Array(pos.count * 3), c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = rise(x, z);
    pos.setY(i, y);
    // Mowing lines follow the contours; a little random grain keeps the surface from looking plastic.
    const stripe = 0.5 + 0.5 * Math.sin(y * 2.6 + x * 0.05);
    c.setHSL(0.25 + rnd() * 0.015, 0.7, 0.2 + stripe * 0.05 + rnd() * 0.025);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new (pos.constructor as typeof import("three").BufferAttribute)(colors, 3));
  geo.computeVertexNormals();
  const land = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  land.castShadow = land.receiveShadow = true;
  scene.add(land);
  const camera = new PerspectiveCamera(34, w / h, 1, 2000);
  camera.position.set(0, 230, 430); camera.lookAt(0, -40, -40);
  renderer.render(scene, camera);
  renderer.shadowMap.enabled = false;
}

const RENDER: Record<string, () => void> = {
  "lines-sky": () => sky("day", true, 2400, 1500, 40),
  "lines-dusk": () => sky("dusk", true, 2400, 1500, 90),
  sky: () => sky("day", false, 2400, 1500, 140),
  amber: () => sky("dusk", false, 2400, 1500, 20),
  forest: () => forest(2400, 1500),
  field: () => field(2400, 1500),
};

declare global { interface Window { renderTexture: (name: string) => Promise<string>; textureNames: string[] } }
window.textureNames = Object.keys(RENDER);
window.renderTexture = (name) => new Promise((resolve) => {
  RENDER[name]!();
  canvas.toBlob((b) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(b!); }, "image/webp", 0.86);
});
