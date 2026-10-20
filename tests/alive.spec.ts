// Never silently freeze: for 60 s, at least a threshold share of pixels must
// change every second, on a real GPU and on software rendering (no GPU), where
// the device tiering has to drop to fewer line-heads to keep moving.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { changed, shot } from "./motion";

const THRESHOLD = 0.005; // 0.5 % of the canvas per second
const results: Record<string, unknown> = {};

for (const [gpu, args] of [["gpu", []], ["software", ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]]] as const) {
    test(`alive for 60 s · ${gpu}`, async ({ playwright }) => {
        test.setTimeout(300_000); // screenshots are slow on software rendering
        const browser = await playwright.chromium.launch({ args: [...args] });
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto("/#n=808");
        await page.waitForFunction(() => (window as any).wake);
        let prev = await shot(page);
        const perSecond: number[] = [];
        for (let s = 0; s < 60; s++) {
            await page.waitForTimeout(1000);
            const cur = await shot(page);
            perSecond.push(changed(prev, cur));
            prev = cur;
        }
        const live = await page.evaluate(() => (window as any).wake.live());
        results[gpu] = { min: Math.min(...perSecond), median: [...perSecond].sort((a, b) => a - b)[30], particles: live.particles, perSecond: perSecond.map(v => +v.toFixed(4)) };
        await browser.close();
        expect(Math.min(...perSecond), `slowest second (${gpu})`).toBeGreaterThan(THRESHOLD);
    });
}

test.afterAll(() => {
    fs.mkdirSync("reports", { recursive: true });
    fs.writeFileSync("reports/alive.json", JSON.stringify({ threshold: THRESHOLD, design: 808, results }, null, 1));
});
