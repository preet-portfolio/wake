// Render a state headlessly and save its plotter SVG via the app's own export.
// usage: node scripts/export-svg.mjs <share-url, hash, or "default"> <out.svg>
import { chromium } from "playwright";
import fs from "node:fs";

const [src, out] = process.argv.slice(2);
const hash = src === "default" ? "" : src.includes("#") ? src.slice(src.indexOf("#")) : `#s=${src}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await page.goto(`http://localhost:5179/?instant${hash}`);
await page.waitForFunction(() => window.wake);
await page.evaluate(() => window.wake.whenDone());
fs.writeFileSync(out, await page.evaluate(() => window.wake.svg()));
console.log(JSON.stringify({ out, budget: await page.evaluate(() => window.wake.budget()) }));
await browser.close();
