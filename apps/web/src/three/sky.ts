import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";

export interface Mood { top: string; horizon: string; glow: string; cloud: string; shade: string; fog: string; ground: string; steel: string; sun: [number, number, number]; cover: number }

// Two skies from the same shader: a clear working day and the last light of a storm evening.
export const MOODS: Record<"day" | "dusk", Mood> = {
  day: { top: "#0b3d73", horizon: "#7fb4e2", glow: "#dcecff", cloud: "#ffffff", shade: "#a9c8e6", fog: "#7fb2de", ground: "#07131f", steel: "#0d1a27", sun: [0.35, 0.22, -1], cover: 0.47 },
  dusk: { top: "#1c1436", horizon: "#f0a04a", glow: "#ffd9a0", cloud: "#f6b98a", shade: "#5a3350", fog: "#c8793e", ground: "#120806", steel: "#1a0d0a", sun: [-0.4, 0.06, -1], cover: 0.48 },
};

const VERT = /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Clouds are fractal noise on a flat layer overhead, lit from the sun side, thinning into haze at
// the horizon. Cheap enough for integrated graphics: five octaves, one layer.
const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop, uHorizon, uGlow, uCloud, uShade, uSun;
uniform float uTime, uCover;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, v = 0.0; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uTop, pow(h, 0.55));
  float sun = max(dot(d, normalize(uSun)), 0.0);
  sky += uGlow * (pow(sun, 5.0) * 0.16 + pow(sun, 48.0) * 0.22);
  vec2 uv = d.xz / (d.y + 0.12) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm(uv) * 0.75 + fbm(uv * 2.7 + 9.0) * 0.25;
  float dens = smoothstep(uCover, uCover + 0.28, n);
  float lit = smoothstep(0.0, 0.5, fbm(uv + normalize(uSun).xz * 0.18) - n + 0.22);
  vec3 cloud = mix(uShade, uCloud, lit) + uGlow * pow(sun, 8.0) * 0.25;
  float fade = smoothstep(0.02, 0.32, h);
  gl_FragColor = vec4(mix(sky, cloud, dens * fade * 0.92), 1.0);
}`;

export function skyDome(mood: Mood): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false, vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uTop: { value: new Color(mood.top) }, uHorizon: { value: new Color(mood.horizon) }, uGlow: { value: new Color(mood.glow) },
      uCloud: { value: new Color(mood.cloud) }, uShade: { value: new Color(mood.shade) },
      uSun: { value: new Vector3(...mood.sun) }, uTime: { value: 0 }, uCover: { value: mood.cover },
    },
  });
  const dome = new Mesh(new SphereGeometry(900, 32, 16), material);
  dome.renderOrder = -1;
  return dome;
}
