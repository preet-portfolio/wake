// Visual regression of the block stack: each case is rendered and compared to
// its stored baseline, and all of them go onto one sheet in reports/.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { CASES, show } from "./helpers";

const shots: [string, string][] = [];

for (const [name, s] of CASES) {
    test(`stack: ${name}`, async ({ page }) => {
        await show(page, s);
        const canvas = page.locator("#art");
        await expect(canvas).toHaveScreenshot(`${name.replace(/[^\w]+/g, "-")}.png`);
        shots.push([name, (await canvas.screenshot()).toString("base64")]);
    });
}

test.afterAll(async ({ browser }) => {
    if (shots.length < CASES.length) return;
    const page = await browser.newPage({ viewport: { width: 1240, height: 400 } });
    await page.setContent(`<body style="margin:0;padding:16px;background:#e6e1d5;font:12px monospace">
      <h2 style="font:italic 32px Georgia;margin:0 0 10px">wake — block stack regression sheet</h2>
      <div style="display:grid;grid-template-columns:repeat(5,232px);gap:10px">
      ${shots.map(([n, b64]) => `<figure style="margin:0"><img src="data:image/png;base64,${b64}" style="width:232px;display:block"><figcaption>${n}</figcaption></figure>`).join("")}
      </div></body>`);
    fs.mkdirSync("reports", { recursive: true });
    await page.screenshot({ path: "reports/stack-sheet.png", fullPage: true });
});
