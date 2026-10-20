// Process GIFs for the case study, rendered by the app itself.
// usage: node scripts/gif.mjs  (dev server on :5179) → public/case/*.gif
import { chromium } from "playwright";
import fs from "node:fs";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await page.goto("http://localhost:5179/");
await page.waitForFunction(() => window.wake);
await page.evaluate(() => window.wake.whenDone());
const base = await page.evaluate(() => structuredClone(window.wake.state));

async function gif(name, frames, delay) {
    const enc = GIFEncoder();
    for (const [i, url] of frames.entries()) {
        const png = PNG.sync.read(Buffer.from(url.split(",")[1], "base64"));
        const palette = quantize(png.data, 32);
        enc.writeFrame(applyPalette(png.data, palette), png.width, png.height, { palette, delay: i === frames.length - 1 ? 1600 : delay });
    }
    enc.finish();
    fs.mkdirSync("public/case", { recursive: true });
    fs.writeFileSync(`public/case/${name}.gif`, enc.bytes());
    console.log(name, frames.length, "frames");
}
const snap = (s, k) => page.evaluate(([s, k]) => window.wake.snapshot(s, k), [s, k]);

// 1. a wake being drawn, step by step
const build = [];
for (let k = 0; k <= base.steps; k += 2) build.push(await snap(base, k));
await gif("build", build, 70);

// 2. the delay span swept from 0: each point's clock starts later and later
const sweep = [];
for (let span = 0; span <= 160; span += 8) {
    const s = structuredClone(base);
    s.blocks.find(b => b.k === "delay").p.span.b = span;
    sweep.push(await snap(s, s.steps));
}
await gif("delay-sweep", sweep, 140);

// 3. one stack, many seeds: points 600 → 2400 and the scale origin wandering
const wander = [];
for (let i = 0; i < 24; i++) {
    const s = structuredClone(base);
    const a = (i / 24) * 2 * Math.PI;
    const rot = s.blocks.find(b => b.k === "rotate");
    rot.p.ox.b = 500 + 160 * Math.cos(a);
    rot.p.oy.b = 500 + 160 * Math.sin(a);
    wander.push(await snap(s, s.steps));
}
await gif("origin-orbit", wander, 110);

await browser.close();
