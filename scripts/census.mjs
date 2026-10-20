// Visual census of the collection: for N design numbers (a fixed, seeded
// sample), capture a frame at 3 s and a 2 s clip (5 frames), plus motion
// measures from the simulation. Writes reports/census/<label>/.
// usage: node scripts/census.mjs <label> [N=300]   (dev server on :5179)
import { chromium } from "playwright";
import fs from "node:fs";

const [label, nArg] = process.argv.slice(2);
const N = +(nArg || 300);
const out = `reports/census/${label}`;
fs.mkdirSync(`${out}/frames`, { recursive: true });
fs.mkdirSync(`${out}/clips`, { recursive: true });

// a fixed sample of design numbers, so before and after look at the same numbers
let a = 12345;
const rand = () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296);
const numbers = Array.from({ length: N }, () => 1 + Math.floor(rand() * 100000));

const browser = await chromium.launch();
const rows = [];
async function worker(list) {
    // small JPEGs: 300 designs × 6 images stay around 35 MB
    const page = await browser.newPage({ viewport: { width: 384, height: 384 }, deviceScaleFactor: 1 });
    for (const n of list) {
        await page.goto(`http://localhost:5179/?particles=4000#n=${n}`);
        await page.waitForFunction(() => window.wake);
        await page.evaluate(() => document.body.classList.add("instant"));
        await page.waitForTimeout(3000);
        await page.locator("#art").screenshot({ path: `${out}/frames/${n}.jpg`, type: "jpeg", quality: 75 });
        const motion = await page.evaluate(() => window.wake.motion());
        const st = await page.evaluate(() => { const s = window.wake.state; return { species: s.species ?? (s.design % 5 === 0 ? "ink" : "classic"), mode: s.live.mode, flow: s.blocks.some(b => b.k === "flow"), scale: s.blocks.some(b => b.k === "scale"), delay: s.blocks.some(b => b.k === "delay"), blend: s.style.blend }; });
        for (let f = 0; f < 5; f++) {
            await page.waitForTimeout(400);
            await page.locator("#art").screenshot({ path: `${out}/clips/${n}-${f}.jpg`, type: "jpeg", quality: 70 });
        }
        rows.push({ n, ...st, ...motion });
    }
    await page.close();
}
const W = 4;
await Promise.all(Array.from({ length: W }, (_, w) => worker(numbers.filter((_, i) => i % W === w))));
await browser.close();
rows.sort((x, y) => numbers.indexOf(x.n) - numbers.indexOf(y.n));
fs.writeFileSync(`${out}/census.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify({ label, captured: rows.length }));
