// Writes public/textures/*.webp from tools/textures.html. Needs the Vite dev server: `npm run dev`,
// then `npm run textures`. Software WebGL is forced so the output is the same on every machine.
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.env.VITE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.error(m.text()); });
await page.goto(`${base}/tools/textures.html`);
await page.waitForFunction(() => Array.isArray(window.textureNames));
const names = process.argv.length > 2 ? process.argv.slice(2) : await page.evaluate(() => window.textureNames);
for (const name of names) {
  const url = await page.evaluate((n) => window.renderTexture(n), name);
  await writeFile(new URL(`../public/textures/${name}.webp`, import.meta.url), Buffer.from(url.split(",")[1], "base64"));
  console.log(`wrote ${name}.webp`);
}
await browser.close();
