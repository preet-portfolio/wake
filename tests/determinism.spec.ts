// The same link must give the same drawing: same SVG, same pixels.
import { test, expect } from "@playwright/test";
import { CASES, show, st } from "./helpers";

test("same state → byte-identical SVG, every case", async ({ page }) => {
    for (const [name, s] of CASES) {
        await show(page, s);
        const a = await page.evaluate(() => (window as any).wake.svg());
        await page.goto("about:blank");
        await show(page, s);
        const b = await page.evaluate(() => (window as any).wake.svg());
        expect(a, name).toBe(b);
    }
});

test("different seed → different drawing when randomness is used", async ({ page }) => {
    const base = CASES.find(([n]) => n === "jitter")![1];
    await show(page, { ...base, seed: 1 });
    const a = await page.evaluate(() => (window as any).wake.svg());
    await show(page, { ...base, seed: 2 });
    const b = await page.evaluate(() => (window as any).wake.svg());
    expect(a).not.toBe(b);
});

test("block order is part of the drawing", async ({ page }) => {
    const get = async (name: string) => {
        await show(page, CASES.find(([n]) => n === name)![1]);
        return page.evaluate(() => (window as any).wake.svg());
    };
    expect(await get("wave → swirl")).not.toBe(await get("swirl → wave"));
    void st;
});
