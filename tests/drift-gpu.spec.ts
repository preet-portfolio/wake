// Drift needs a real GPU to run smoothly, so this file runs without software GL.
import { test, expect, type Page } from "@playwright/test";

test.use({ launchOptions: { args: [] } });

const pixels = (page: Page) => page.evaluate(() => (document.querySelector("#art") as HTMLCanvasElement).toDataURL());

test("the drawing shifts by itself, and hold freezes it into a link", async ({ page }) => {
    await page.goto("/?nohold"); // auto-hold has its own test; here only drift is checked
    await page.waitForFunction(() => (window as any).wake);
    await page.waitForTimeout(1500);
    const p1 = await pixels(page);
    await page.waitForTimeout(2500);
    const p2 = await pixels(page);
    expect(p1).not.toBe(p2);

    await page.click(".drift");
    await expect(page.locator(".drift")).toHaveText("▶ drift");
    expect(page.url()).toContain("#s=");
    await page.evaluate(() => (window as any).wake.whenDone());
    const held = await pixels(page);
    await page.waitForTimeout(1500);
    expect(await pixels(page)).toBe(held);
});
