// GIFs of the live simulation for the case study (dev server on :5179).
// usage: node scripts/gif-live.mjs → public/case/live-*.gif
import { chromium } from "playwright";
import fs from "node:fs";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const browser = await chromium.launch();
async function record(name, n, { stir = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 1 });
    await page.goto(`http://localhost:5179/?particles=8000#n=${n}`);
    await page.waitForFunction(() => window.wake);
    await page.evaluate(() => document.body.classList.add("instant")); // hide controls in the recording
    await page.waitForTimeout(1500);
    const box = await page.locator("#art").boundingBox();
    const enc = GIFEncoder();
    for (let f = 0; f < 36; f++) {
        if (stir) {
            const a = f / 36 * Math.PI * 2;
            await page.mouse.move(box.x + box.width * (0.5 + 0.25 * Math.cos(a)), box.y + box.height * (0.5 + 0.25 * Math.sin(a)), { steps: 3 });
        }
        const buf = await page.locator("#art").screenshot();
        const png = PNG.sync.read(buf);
        // downscale 2x by sampling, keeps the GIF small
        const w = png.width >> 1, h = png.height >> 1, data = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = png.data[((y * 2) * png.width + x * 2) * 4 + c];
        const palette = quantize(data, 128);
        enc.writeFrame(applyPalette(data, palette), w, h, { palette, delay: 80 });
        await page.waitForTimeout(40);
    }
    enc.finish();
    fs.writeFileSync(`public/case/${name}.gif`, enc.bytes());
    console.log(name, "done");
    await page.close();
}
await record("live-flow", 16);
await record("live-rings", 1);
await record("live-stir", 808, { stir: true });
await browser.close();
