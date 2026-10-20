// A fresh visit gets its own design and keeps shifting; hold freezes it into a link.
import { test, expect, type Page } from "@playwright/test";

const pixels = (page: Page) => page.evaluate(() => (document.querySelector("#art") as HTMLCanvasElement).toDataURL());

test("each fresh visit starts from a different design", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const a = JSON.stringify((await page.evaluate(() => (window as any).wake.state)).blocks);
    await page.waitForTimeout(20); // surprise() is seeded by the clock
    await page.goto("about:blank");
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    const b = JSON.stringify((await page.evaluate(() => (window as any).wake.state)).blocks);
    expect(a).not.toBe(b);
    expect(page.url()).not.toContain("#s="); // a drifting page keeps a clean URL
});

test("on a slow device (software GL) drift holds itself instead of stuttering", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    await expect(page.locator(".drift")).toHaveText("▶ drift", { timeout: 15_000 });
    expect(page.url()).toContain("#s="); // the held frame is a shareable link
});

test("a shared link opens still", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => (window as any).wake);
    // hold it (a slow device may already have held itself)
    if ((await page.textContent(".drift")) === "❚❚ hold") await page.click(".drift");
    await expect(page.locator(".drift")).toHaveText("▶ drift");
    const link = page.url();
    expect(link).toContain("#s=");
    await page.goto("about:blank");
    await page.goto(link);
    await page.waitForFunction(() => (window as any).wake);
    await expect(page.locator(".drift")).toBeHidden();
    await page.evaluate(() => (window as any).wake.whenDone());
    const a = await pixels(page);
    await page.waitForTimeout(1500);
    expect(await pixels(page)).toBe(a);
});
