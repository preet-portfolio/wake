// The numbered collection: a number is a fixed design, on every device.
import { test, expect } from "@playwright/test";
import { designFor, modeOf } from "../src/design";
import { DESIGNS } from "../src/model";
import { encode } from "../src/state";
import { budget } from "../src/export";

const NUMBERS = [1, 2, 5, 808, 4444, 12345, 99999, DESIGNS];

test("a number gives the same design in Node and in the browser", async ({ page }) => {
    for (const n of NUMBERS) {
        const node = encode(designFor(n));
        await page.goto(`/?instant#n=${n}`);
        await page.waitForFunction(() => (window as any).wake);
        const browser = await page.evaluate(() => (window as any).wake.state);
        expect(encode(browser), `No. ${n}`).toBe(node);
        await page.goto("about:blank");
    }
});

test("a number gives the same SVG every time", async ({ page }) => {
    for (const n of [808, 500]) {
        const svgs: string[] = [];
        for (let i = 0; i < 2; i++) {
            await page.goto(`/?instant#n=${n}`);
            await page.waitForFunction(() => (window as any).wake);
            await page.evaluate(() => (window as any).wake.whenDone());
            svgs.push(await page.evaluate(() => (window as any).wake.svg()));
            await page.goto("about:blank");
        }
        expect(svgs[0]).toBe(svgs[1]);
    }
});

test("one in five numbers is an ink piece, and ink pieces fit the plot budget", () => {
    expect(modeOf(500)).toBe("ink");
    expect(modeOf(501)).toBe("colour");
    // 100 ink numbers spread across the collection, judged with the same budget as plotcheck.py
    let pass = 0;
    for (let i = 1; i <= 100; i++) if (budget(designFor(i * 5 * 97)).pass) pass++;
    expect(pass, `${pass}/100 ink pieces plottable`).toBeGreaterThanOrEqual(98);
});

test("an untouched design shares as a short #n= link; an edit switches to the full state", async ({ page }) => {
    await page.goto(`/?instant&edit#n=808`);
    await page.waitForFunction(() => (window as any).wake);
    await expect(page.locator(".number")).toHaveText("No. 808");
    expect(page.url()).toMatch(/#n=808$/);
    await page.locator(".knob input").first().fill("900");
    await page.locator(".knob input").first().dispatchEvent("input");
    await expect(page.locator(".number")).toHaveText("No. 808 · edited");
    expect(page.url()).toContain("#s=");
});
